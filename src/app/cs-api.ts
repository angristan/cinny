import to from 'await-to-js';
import { trimTrailingSlash } from './utils/common';

const HOMESERVER_URL_REG = /^https?:\/\//;

export enum AutoDiscoveryAction {
  PROMPT = 'PROMPT',
  IGNORE = 'IGNORE',
  FAIL_PROMPT = 'FAIL_PROMPT',
  FAIL_ERROR = 'FAIL_ERROR',
}

export type AutoDiscoveryError = {
  host: string;
  action: AutoDiscoveryAction;
};

export type AutoDiscoveryInfo = Record<string, unknown> & {
  'm.homeserver': {
    base_url: string;
  };
  'm.identity_server'?: {
    base_url: string;
  };
  'org.matrix.msc2965.authentication'?: {
    account?: string;
    issuer?: string;
  };
  'org.matrix.msc4143.rtc_foci'?: [
    {
      livekit_service_url: string;
      type: 'livekit';
    }
  ];
};

type AutoDiscoveryResult = [AutoDiscoveryError, undefined] | [undefined, AutoDiscoveryInfo];

const fallbackAutoDiscoveryInfo = (host: string): AutoDiscoveryInfo => ({
  'm.homeserver': {
    base_url: host,
  },
});

const getAutoDiscoveryHosts = (server: string): string[] => {
  const trimmedServer = trimTrailingSlash(server.trim());

  if (HOMESERVER_URL_REG.test(trimmedServer)) {
    return [trimmedServer];
  }

  return [`https://${trimmedServer}`, `http://${trimmedServer}`];
};

const discoverHost = async (
  request: typeof fetch,
  host: string
): Promise<{ requestFailed: boolean; result: AutoDiscoveryResult }> => {
  const autoDiscoveryUrl = `${host}/.well-known/matrix/client`;

  const [err, response] = await to(request(autoDiscoveryUrl, { method: 'GET' }));

  if (err || response.status === 404) {
    // AutoDiscoveryAction.IGNORE
    // We will use default value for IGNORE action
    return {
      requestFailed: !!err,
      result: [undefined, fallbackAutoDiscoveryInfo(host)],
    };
  }
  if (response.status !== 200) {
    return {
      requestFailed: false,
      result: [
        {
          host,
          action: AutoDiscoveryAction.FAIL_PROMPT,
        },
        undefined,
      ],
    };
  }

  const [contentErr, content] = await to<AutoDiscoveryInfo>(response.json());

  if (contentErr || typeof content !== 'object') {
    return {
      requestFailed: false,
      result: [
        {
          host,
          action: AutoDiscoveryAction.FAIL_PROMPT,
        },
        undefined,
      ],
    };
  }

  const baseUrl = content['m.homeserver']?.base_url;
  if (typeof baseUrl !== 'string') {
    return {
      requestFailed: false,
      result: [
        {
          host,
          action: AutoDiscoveryAction.FAIL_PROMPT,
        },
        undefined,
      ],
    };
  }

  if (HOMESERVER_URL_REG.test(baseUrl) === false) {
    return {
      requestFailed: false,
      result: [
        {
          host,
          action: AutoDiscoveryAction.FAIL_ERROR,
        },
        undefined,
      ],
    };
  }

  content['m.homeserver'].base_url = trimTrailingSlash(baseUrl);
  if (content['m.identity_server']) {
    content['m.identity_server'].base_url = trimTrailingSlash(
      content['m.identity_server'].base_url
    );
  }

  return {
    requestFailed: false,
    result: [undefined, content],
  };
};

export const autoDiscovery = async (
  request: typeof fetch,
  server: string
): Promise<AutoDiscoveryResult> => {
  const hosts = getAutoDiscoveryHosts(server);
  const primaryAttempt = await discoverHost(request, hosts[0]);

  if (!primaryAttempt.requestFailed || hosts.length === 1) {
    return primaryAttempt.result;
  }

  const httpAttempt = await discoverHost(request, hosts[1]);

  if (!httpAttempt.requestFailed) {
    return httpAttempt.result;
  }

  return primaryAttempt.result;
};

export type SpecVersions = {
  versions: string[];
  unstable_features?: Record<string, boolean>;
};
export const specVersions = async (
  request: typeof fetch,
  baseUrl: string
): Promise<SpecVersions> => {
  const res = await request(`${trimTrailingSlash(baseUrl)}/_matrix/client/versions`);

  const data = (await res.json()) as unknown;

  if (data && typeof data === 'object' && 'versions' in data && Array.isArray(data.versions)) {
    return data as SpecVersions;
  }
  throw new Error('Homeserver URL does not appear to be a valid Matrix homeserver');
};
