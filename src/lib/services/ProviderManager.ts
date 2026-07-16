import { providerContext } from "../providers/providerContext";
import { providerFetch } from "../providers/tauriAxiosAdapter";
import { Catalog, EpisodeLink, Info, Post } from "../providers/types";
import { extensionManager } from "./ExtensionManager";

export class ProviderManager {
  private createExecutionContext(providerValue: string) {
    const providerConsole = new Proxy(console, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (
          typeof value === "function" &&
          ["debug", "error", "info", "log", "warn"].includes(String(property))
        ) {
          return (...args: unknown[]) =>
            value.call(target, `[Provider:${providerValue}]`, ...args);
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    return {
      exports: {},
      require: () => ({}), // Mock require function
      module: { exports: {} },
      console: providerConsole,
      Promise,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      fetch: providerFetch,
      __awaiter: (thisArg: any, _arguments: any, P: any, generator: any) => {
        function adopt(value: any) {
          return value instanceof P
            ? value
            : new P(function (resolve: any) {
                resolve(value);
              });
        }
        return new (P || (P = Promise))(function (resolve: any, reject: any) {
          function fulfilled(value: any) {
            try {
              step(generator.next(value));
            } catch (e) {
              reject(e);
            }
          }
          function rejected(value: any) {
            try {
              step(generator.throw(value));
            } catch (e) {
              reject(e);
            }
          }
          function step(result: any) {
            result.done
              ? resolve(result.value)
              : adopt(result.value).then(fulfilled, rejected);
          }
          step((generator = generator.apply(thisArg, _arguments || [])).next());
        });
      },
      Object,
    };
  }

  private executeModule(
    moduleCode: string,
    providerValue: string,
    ...args: any[]
  ): any {
    const context = this.createExecutionContext(providerValue);

    const executeModule = new Function(
      "context",
      ...Array.from({ length: args.length }, (_, i) => `arg${i}`),
      `
      const exports = context.exports;
      const __awaiter = context.__awaiter;
      const Object = context.Object;
      const console = context.console;
      const Promise = context.Promise;
      const setTimeout = context.setTimeout;
      const clearTimeout = context.clearTimeout;
      const setInterval = context.setInterval;
      const clearInterval = context.clearInterval;
      const fetch = context.fetch;
      
      ${moduleCode}
      
      return exports;
      `,
    );
    return executeModule(context, ...args);
  }
  getCatalog = ({ providerValue }: { providerValue: string }): Catalog[] => {
    // Use extensionManager which now handles test mode automatically
    const catalogModule =
      extensionManager.getProviderModules(providerValue)?.modules.catalog;
    if (!catalogModule) {
      return [];
    }
    try {
      const moduleExports = this.executeModule(catalogModule, providerValue);

      // Return the catalog array directly from exports
      return moduleExports.catalog || [];
    } catch (error) {
      console.error("Error loading catalog:", error);
      console.error("Module content:", catalogModule);
      throw new Error(`Invalid catalog module for provider: ${providerValue}`);
    }
  };
  getGenres = ({ providerValue }: { providerValue: string }): Catalog[] => {
    // Use extensionManager which now handles test mode automatically
    const catalogModule =
      extensionManager.getProviderModules(providerValue)?.modules.catalog;
    if (!catalogModule) {
      return [];
    }
    try {
      const moduleExports = this.executeModule(catalogModule, providerValue);

      // Return the genres array directly from exports
      return moduleExports.genres || [];
    } catch (error) {
      console.error("Error loading genres:", error);
      console.error("Module content:", catalogModule);
      throw new Error(`Invalid catalog module for provider: ${providerValue}`);
    }
  };
  getPosts = async ({
    filter,
    page,
    providerValue,
    signal,
  }: {
    filter: string;
    page: number;
    providerValue: string;
    signal: AbortSignal;
  }): Promise<Post[]> => {
    // Use extensionManager which now handles test mode automatically
    const getPostsModule = (
      await extensionManager.getProviderModulesAsync(providerValue)
    )?.modules.posts;
    if (!getPostsModule) {
      throw new Error(`No posts module found for provider: ${providerValue}`);
    }
    try {
      const moduleExports = this.executeModule(
        getPostsModule,
        providerValue,
        filter,
        page,
        providerValue,
        signal,
        providerContext,
      );

      // Call the getPosts function
      return await moduleExports.getPosts({
        filter,
        page,
        providerValue,
        signal,
        providerContext,
      });
    } catch (error: any) {
      console.error("Error in posts function:", error);
      // Re-throw the original error message if it exists, otherwise use generic message
      const errorMessage =
        error?.message || `Failed to get posts from provider: ${providerValue}`;
      throw new Error(errorMessage);
    }
  };
  getSearchPosts = async ({
    searchQuery,
    page,
    providerValue,
    signal,
  }: {
    searchQuery: string;
    page: number;
    providerValue: string;
    signal: AbortSignal;
  }): Promise<Post[]> => {
    // Use extensionManager which now handles test mode automatically
    const getPostsModule = (
      await extensionManager.getProviderModulesAsync(providerValue)
    )?.modules.posts;
    if (!getPostsModule) {
      throw new Error(`No posts module found for provider: ${providerValue}`);
    }
    try {
      const moduleExports = this.executeModule(
        getPostsModule,
        providerValue,
        searchQuery,
        page,
        providerValue,
        signal,
        providerContext,
      );

      // Call the getSearchPosts function
      return await moduleExports.getSearchPosts({
        searchQuery,
        page,
        providerValue,
        signal,
        providerContext,
      });
    } catch (error: any) {
      console.error("Error in search posts function:", error);
      // Re-throw the original error message if it exists, otherwise use generic message
      const errorMessage =
        error?.message ||
        `Failed to search posts from provider: ${providerValue}`;
      throw new Error(errorMessage);
    }
  };
  getMetaData = async ({
    link,
    provider,
  }: {
    link: string;
    provider: string;
  }): Promise<Info> => {
    // Use extensionManager which now handles test mode automatically
    const getMetaDataModule = (
      await extensionManager.getProviderModulesAsync(provider)
    )?.modules.meta;
    if (!getMetaDataModule) {
      throw new Error(`No meta data module found for provider: ${provider}`);
    }
    try {
      const moduleExports = this.executeModule(
        getMetaDataModule,
        provider,
        link,
        provider,
        providerContext,
      );

      // Call the getMetaData function
      return await moduleExports.getMeta({
        link,
        provider,
        providerContext,
      });
    } catch (error: any) {
      console.error("Error in meta data function:", error);
      // Re-throw the original error message if it exists, otherwise use generic message
      const errorMessage =
        error?.message || `Failed to get metadata from provider: ${provider}`;
      throw new Error(errorMessage);
    }
  };
  getStream = async ({
    link,
    type,
    signal,
    providerValue,
  }: {
    link: string;
    type: string;
    signal: AbortSignal;
    providerValue: string;
  }): Promise<any[]> => {
    // Use extensionManager which now handles test mode automatically
    const getStreamModule = (
      await extensionManager.getProviderModulesAsync(providerValue)
    )?.modules.stream;
    if (!getStreamModule) {
      throw new Error(`No stream module found for provider: ${providerValue}`);
    }
    try {
      console.log(`[Provider:${providerValue}] Executing stream module`, {
        link,
        type,
        moduleBytes: getStreamModule.length,
      });
      const moduleExports = this.executeModule(
        getStreamModule,
        providerValue,
        link,
        type,
        signal,
        providerContext,
      );

      console.log(
        `[Provider:${providerValue}] Stream module exports`,
        Object.keys(moduleExports),
      );

      if (typeof moduleExports.getStream !== "function") {
        throw new Error("Stream module does not export getStream");
      }

      // Call the getStream function
      const streams = await moduleExports.getStream({
        link,
        type,
        signal,
        providerContext,
      });
      console.log(
        `[Provider:${providerValue}] getStream returned`,
        Array.isArray(streams) ? `${streams.length} stream(s)` : streams,
      );
      return streams;
    } catch (error: any) {
      console.error("Error in stream function:", error);
      // Re-throw the original error message if it exists, otherwise use generic message
      const errorMessage =
        error?.message ||
        `Failed to get stream from provider: ${providerValue}`;
      throw new Error(errorMessage);
    }
  };
  getEpisodes = async ({
    url,
    providerValue,
  }: {
    url: string;
    providerValue: string;
  }): Promise<EpisodeLink[]> => {
    // Use extensionManager which now handles test mode automatically
    const getEpisodeLinksModule = (
      await extensionManager.getProviderModulesAsync(providerValue)
    )?.modules.episodes;
    if (!getEpisodeLinksModule) {
      throw new Error(
        `No episode links module found for provider: ${providerValue}`,
      );
    }
    try {
      const moduleExports = this.executeModule(
        getEpisodeLinksModule,
        providerValue,
        url,
        providerContext,
      );

      // Call the getEpisodes function
      return await moduleExports.getEpisodes({
        url,
        providerContext,
      });
    } catch (error: any) {
      console.error("Error in episodes function:", error);
      // Re-throw the original error message if it exists, otherwise use generic message
      const errorMessage =
        error?.message ||
        `Failed to get episodes from provider: ${providerValue}`;
      console.warn(errorMessage);
      throw new Error(errorMessage);
    }
  };
}

export const providerManager = new ProviderManager();
