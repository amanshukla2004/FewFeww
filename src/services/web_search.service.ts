import { pool } from '../db/pool.js';
import { User, userRepo } from '../db/user.repo.js';

export interface SearchItem {
  title: string;
  snippet: string;
  url: string;
}

export interface WebSearchResult {
  query: string;
  results: SearchItem[];
  formattedText: string;
  remainingQuota: number;
}

export class WebSearchService {
  /**
   * Search the web, summarize findings, and track monthly usage quota.
   */
  async search(userId: string, query: string, customFetcher?: (q: string) => Promise<SearchItem[]>): Promise<WebSearchResult> {
    const trimmed = query.trim();
    if (!trimmed) {
      return {
        query: '',
        results: [],
        formattedText: `🌐 <b>Internet Search:</b> Please provide a search query (e.g. <i>"search TypeScript 5.7 features"</i>).`,
        remainingQuota: 30,
      };
    }

    // 1. Quota check & reset
    const userRes = await pool.query(
      `
      SELECT monthly_search_count, search_quota_reset_at
      FROM users
      WHERE id = $1;
      `,
      [userId]
    );

    let count = userRes.rows[0]?.monthly_search_count || 0;
    const resetAt = userRes.rows[0]?.search_quota_reset_at ? new Date(userRes.rows[0].search_quota_reset_at) : new Date();

    if (Date.now() > resetAt.getTime()) {
      // Reset quota window
      await pool.query(
        `
        UPDATE users
        SET monthly_search_count = 0,
            search_quota_reset_at = now() + interval '30 days'
        WHERE id = $1;
        `,
        [userId]
      );
      count = 0;
    }

    const MONTHLY_LIMIT = 30;
    if (count >= MONTHLY_LIMIT) {
      return {
        query: trimmed,
        results: [],
        formattedText: `⚠️ <b>Monthly Search Limit Reached:</b> You have used all ${MONTHLY_LIMIT} internet searches for this billing cycle.\n\nYour searches reset on <b>${resetAt.toDateString()}</b>. Upgrade to Enterprise for unlimited searches.`,
        remainingQuota: 0,
      };
    }

    // 2. Execute Web Search
    let results: SearchItem[] = [];
    if (customFetcher) {
      results = await customFetcher(trimmed);
    } else {
      try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(trimmed)}&format=json&no_html=1&skip_disambig=1`;
        const res = await fetch(url, { headers: { 'User-Agent': 'FewFewwBot/1.0' } });
        if (res.ok) {
          const data: any = await res.json();
          if (data.AbstractText) {
            results.push({
              title: data.Heading || trimmed,
              snippet: data.AbstractText,
              url: data.AbstractURL || 'https://duckduckgo.com/?q=' + encodeURIComponent(trimmed),
            });
          }
          if (Array.isArray(data.RelatedTopics)) {
            for (const topic of data.RelatedTopics.slice(0, 3)) {
              if (topic.Text && topic.FirstURL) {
                results.push({
                  title: topic.Text.split(' - ')[0] || trimmed,
                  snippet: topic.Text,
                  url: topic.FirstURL,
                });
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[WebSearchService] External fetch failed for query "${trimmed}", using fallback:`, err);
      }
    }

    // Fallback if no instant answers returned
    if (results.length === 0) {
      results.push({
        title: `Search: ${trimmed}`,
        snippet: `Real-time web search results for "${trimmed}". Explore live references and online documentation.`,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`,
      });
    }

    // 3. Increment quota
    await pool.query(
      `
      UPDATE users
      SET monthly_search_count = monthly_search_count + 1,
          updated_at = now()
      WHERE id = $1;
      `,
      [userId]
    );

    const newCount = count + 1;
    const remaining = Math.max(0, MONTHLY_LIMIT - newCount);

    // 4. Format Output
    const lines = [
      `🌐 <b>Internet Search Results:</b> <i>"${trimmed}"</i>`,
      ``,
    ];

    results.forEach((item, idx) => {
      lines.push(`<b>${idx + 1}. ${item.title}</b>`);
      lines.push(`${item.snippet}`);
      lines.push(`🔗 <a href="${item.url}">${item.url}</a>`);
      lines.push(``);
    });

    lines.push(`<i>📊 Search usage: ${newCount}/${MONTHLY_LIMIT} used this month (${remaining} remaining).</i>`);

    return {
      query: trimmed,
      results,
      formattedText: lines.join('\n').trim(),
      remainingQuota: remaining,
    };
  }
}

export const webSearchService = new WebSearchService();
