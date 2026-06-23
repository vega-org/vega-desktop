import {ProviderSource} from '../storage/extensionStorage';

export const formatName = (name: string): string => {
  // Replace special characters with an underscore
  return name.replace(/[^a-zA-Z0-9]/g, '_');
};

const DEFAULT_REPO_NAME = 'vega-providers';
const DEFAULT_BRANCH = 'main';
const RAW_GITHUB_HOST = 'raw.githubusercontent.com';
const GITHUB_HOST = 'github.com';

export const normalizeUrl = (url: string): string => {
  return url.trim().replace(/\/+$/, '');
};

const buildRawGithubUrl = (
  author: string,
  repo = DEFAULT_REPO_NAME,
  branch = DEFAULT_BRANCH,
): string => {
  return `https://${RAW_GITHUB_HOST}/${author}/${repo}/refs/heads/${branch}`;
};

type ParsedGithubSource = {
  author: string;
  repo: string;
  branch: string;
};

const parseRawGithubUrl = (url: URL): ParsedGithubSource | null => {
  if (url.hostname !== RAW_GITHUB_HOST) {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 4) {
    return null;
  }

  const author = segments[0];
  const repo = segments[1];
  let branch = DEFAULT_BRANCH;

  if (
    segments[2] === 'refs' &&
    segments[3] === 'heads' &&
    segments.length > 4
  ) {
    branch = decodeURIComponent(segments.slice(4).join('/'));
  }

  if (!author || !repo) {
    return null;
  }

  return {author, repo, branch};
};

const parseGithubRepoUrl = (url: URL): ParsedGithubSource | null => {
  if (url.hostname !== GITHUB_HOST) {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  const author = segments[0];
  const repo = segments[1];
  let branch = DEFAULT_BRANCH;

  if (segments[2] === 'tree' && segments.length > 3) {
    branch = decodeURIComponent(segments.slice(3).join('/'));
  }

  if (!author || !repo) {
    return null;
  }

  return {author, repo, branch};
};

export const createProviderSource = (value: string): ProviderSource => {
  const input = value.trim();
  if (!input) {
    throw new Error('Provider source value is required');
  }

  const isUrlInput = /^https?:\/\//i.test(input);

  if (isUrlInput) {
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      throw new Error('Invalid provider source URL');
    }

    const parsedSource =
      parseRawGithubUrl(parsed) || parseGithubRepoUrl(parsed);
    if (!parsedSource) {
      throw new Error(
        'Only github.com or raw.githubusercontent.com provider source URLs are supported',
      );
    }

    return {
      author: parsedSource.author,
      url: buildRawGithubUrl(
        parsedSource.author,
        parsedSource.repo,
        parsedSource.branch,
      ),
      isDefault: false,
    };
  }

  const author = input.replace(/^@/, '').trim();
  if (!author) {
    throw new Error('Invalid GitHub author name');
  }

  return {
    author,
    url: buildRawGithubUrl(author),
    isDefault: false,
  };
};
