import { WebSearchProvider } from '../types';
import { tavilyProvider } from './tavily';
import { firecrawlProvider } from './firecrawl';

// 注册所有可用的 Providers
export const availableProviders: Record<string, WebSearchProvider> = {
  tavily: tavilyProvider,
  firecrawl: firecrawlProvider,
};
