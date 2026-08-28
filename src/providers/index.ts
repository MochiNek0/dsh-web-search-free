import { WebSearchProvider } from '../types.js';
import { tavilyProvider } from './tavily.js';
import { firecrawlProvider } from './firecrawl.js';
import { jinaProvider } from './jina.js';
import { exaProvider } from './exa.js';
import { braveProvider } from './brave.js';
import { anysearchProvider } from './anysearch.js';
import { tinyfishProvider } from './tinyfish.js';
import { serpapiProvider } from './serpapi.js';

// 注册所有可用的 Providers
export const availableProviders: Record<string, WebSearchProvider> = {
  tavily: tavilyProvider,
  firecrawl: firecrawlProvider,
  jina: jinaProvider,
  exa: exaProvider,
  brave: braveProvider,
  anysearch: anysearchProvider,
  tinyfish: tinyfishProvider,
  serpapi: serpapiProvider,
};
