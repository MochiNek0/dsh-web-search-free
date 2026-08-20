import { WebSearchProvider } from '../types';
import { tavilyProvider } from './tavily';
import { firecrawlProvider } from './firecrawl';
import { jinaProvider } from './jina';
import { exaProvider } from './exa';
import { braveProvider } from './brave';

// 注册所有可用的 Providers
export const availableProviders: Record<string, WebSearchProvider> = {
  tavily: tavilyProvider,
  firecrawl: firecrawlProvider,
  jina: jinaProvider,
  exa: exaProvider,
  brave: braveProvider,
};
