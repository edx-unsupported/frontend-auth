import PubSub from 'pubsub-js';
import { NewRelicLoggingService } from '@edx/frontend-logging';

import AccessToken from '../AccessToken';
import applyMockAuthInterface from './mockAuthInterface';
import axiosConfig from '../axiosConfig';
import getAuthenticatedAPIClient from '../index';

const authConfig = {
  appBaseUrl: process.env.BASE_URL,
  accessTokenCookieName: process.env.ACCESS_TOKEN_COOKIE_NAME,
  loginUrl: process.env.LOGIN_URL,
  logoutUrl: process.env.LOGOUT_URL,
  refreshAccessTokenEndpoint: process.env.REFRESH_ACCESS_TOKEN_ENDPOINT,
  loggingService: NewRelicLoggingService, // any concrete logging service will do
};

const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);

jest.mock('../AccessToken', () => {
  const mockAccessTokenInstance = {
    value: undefined,
    isExpired: true,
    refresh: jest.fn(),
    get: jest.fn(),
  };
  return () => mockAccessTokenInstance;
});
const mockAccessToken = new AccessToken({});

// client is a singleton, so we need to store originals once before any mocking
const client = getAuthenticatedAPIClient(authConfig);
const originalGetDecodedAccessToken = client.getDecodedAccessToken;
const originalIsAccessTokenExpired = client.isAccessTokenExpired;

beforeEach(() => {
  client.getDecodedAccessToken = originalGetDecodedAccessToken;
  client.isAccessTokenExpired = originalIsAccessTokenExpired;
  jest.spyOn(global.document, 'referrer', 'get').mockReturnValue('');
});

function expectGetCsrfTokenToHaveBeenCalled() {
  expect(client.getCsrfToken).toHaveBeenCalled();
}

function expectGetCsrfTokenToNotHaveBeenCalled() {
  expect(client.getCsrfToken).not.toHaveBeenCalled();
}

function expectCsrfHeaderSet(request) {
  expect(request.headers['X-CSRFToken']).toBe('test-csrf-token');
}

function testCsrfTokenInterceptorFulfillment(
  isCsrfExempt,
  method,
  queueRequests,
  csrfTokens,
  expects,
  expectHeaderSet,
) {
  it(`${expects.name} when isCsrfExempt=${isCsrfExempt} and method=${method} and queueRequests=${queueRequests} and csrfTokens=${JSON.stringify(csrfTokens)}`, () => {
    applyMockAuthInterface(client);
    client.isCsrfExempt.mockReturnValue(isCsrfExempt);
    /* eslint-disable no-underscore-dangle */
    axiosConfig.__Rewire__('queueRequests', queueRequests);
    axiosConfig.__Rewire__('csrfTokens', csrfTokens);
    /* eslint-enable no-underscore-dangle */
    const fulfilledResult = client.interceptors.request.handlers[0].fulfilled({
      url: 'https://testserver.org',
      method,
      headers: {},
    });
    expects(client);

    if (expectHeaderSet) {
      if (client.getCsrfToken.mock.calls.length || queueRequests) {
        fulfilledResult.then((request) => {
          expectCsrfHeaderSet(request);
        });
      } else {
        expectCsrfHeaderSet(fulfilledResult);
      }
    }
  });
}

describe('getAuthenticatedAPIClient', () => {
  it('returns a singleton', () => {
    const client1 = getAuthenticatedAPIClient(authConfig);
    const client2 = getAuthenticatedAPIClient(authConfig);
    expect(client2).toBe(client1);
  });
});

describe('AuthenticatedAPIClient auth interface', () => {
  window.location.assign = jest.fn();

  it('has method login', () => {
    const loginUrl = process.env.LOGIN_URL;
    const expectedRedirectUrl = encodeURIComponent(process.env.BASE_URL);
    const expectedLocation = `${loginUrl}?next=${expectedRedirectUrl}`;
    [process.env.BASE_URL, undefined].forEach((redirectUrl) => {
      client.login(redirectUrl);
      expect(window.location.assign).toHaveBeenCalledWith(expectedLocation);
    });
  });

  it('has method logout', () => {
    const logoutUrl = process.env.LOGOUT_URL;
    const expectedRedirectUrl = encodeURIComponent(process.env.BASE_URL);
    const expectedLocation = `${logoutUrl}?redirect_url=${expectedRedirectUrl}`;
    [process.env.BASE_URL, undefined].forEach((redirectUrl) => {
      client.logout(redirectUrl);
      expect(window.location.assign).toHaveBeenCalledWith(expectedLocation);
    });
  });

  it('has method getCsrfToken', () => {
    client.get = jest.fn();
    const mockResponse = {};

    client.get.mockReturnValueOnce(new Promise(resolve => resolve(mockResponse)));
    client.getCsrfToken();
    expect(client.get).toHaveBeenCalled();
  });

  it('has method isCsrfExempt', () => {
    const csrfExemptUrl = process.env.REFRESH_ACCESS_TOKEN_ENDPOINT;
    const nonCsrfExemptUrl = 'http://example.com';
    expect(client.isCsrfExempt(csrfExemptUrl)).toBe(true);
    expect(client.isCsrfExempt(nonCsrfExemptUrl)).toBe(false);
  });

  describe('ensureAuthenticatedUser', () => {
    beforeEach(() => {
      mockAccessToken.value = undefined;
      mockAccessToken.refresh.mockReset();
      window.location.assign.mockReset();
    });

    it('redirects to login when no valid JWT', () => {
      const loginUrl = process.env.LOGIN_URL;
      const expectedRedirectUrl = encodeURIComponent(process.env.BASE_URL);
      const expectedLocation = `${loginUrl}?next=${expectedRedirectUrl}`;
      // eslint-disable-next-line prefer-promise-reject-errors
      mockAccessToken.get.mockReturnValue(Promise.resolve(null));

      return client.ensureAuthenticatedUser('').finally(() => {
        expect(window.location.assign).toHaveBeenCalledWith(expectedLocation);
      });
    });

    it('errors when no valid JWT after coming from login', async () => {
      jest.spyOn(global.document, 'referrer', 'get').mockReturnValue(process.env.LOGIN_URL);
      // eslint-disable-next-line prefer-promise-reject-errors
      mockAccessToken.get.mockReturnValue(Promise.resolve(null));

      await expect(client.ensureAuthenticatedUser('')).rejects
        .toThrow(new Error('Redirect from login page. Rejecting to avoid infinite redirect loop.'));
    });

    it('promise resolves to access token', async () => {
      const expectedValue = {
        authenticatedUser: {
          userId: 'test',
        },
        decodedAccessToken: {},
        anything: 'any value returned by access token',
      };
      mockAccessToken.get.mockReturnValue(Promise.resolve(expectedValue));

      return expect(client.ensureAuthenticatedUser('')).resolves.toEqual(expectedValue);
    });

    it('logs out and redirects if there is an unexpected problem refreshing the jwt cookie', async () => {
      jest.spyOn(client, 'logout');
      mockAccessToken.get.mockReturnValue(Promise.reject());
      return client.ensureAuthenticatedUser('').catch(() => {
        expect(client.logout).toHaveBeenCalled();
        client.logout.mockRestore();
      });
    });
  });
});

describe('AuthenticatedAPIClient request headers', () => {
  it('should contain USE-JWT-COOKIE', () => {
    expect(client.defaults.headers.common['USE-JWT-COOKIE']).toBe(true);
  });
});

describe('AuthenticatedAPIClient ensureValidJWTCookie request interceptor', () => {
  beforeEach(() => {
    PubSub.clearAllSubscriptions();
    mockAccessToken.get.mockReset();
  });

  it('fulfills after calling get if the token is expired', () => {
    mockAccessToken.get.mockReturnValue(Promise.resolve());
    const fulfilledResult = client.interceptors.request.handlers[1].fulfilled({});
    expect(mockAccessToken.get).toHaveBeenCalled();
    return expect(fulfilledResult).resolves.toBeInstanceOf(Object);
  });

  it('rejects after calling unsuccessful get', () => {
    mockAccessToken.get.mockReturnValue(Promise.reject());
    const fulfilledResult = client.interceptors.request.handlers[1].fulfilled({});
    expect(mockAccessToken.get).toHaveBeenCalled();
    return expect(fulfilledResult).rejects.toBeUndefined();
  });

  it('returns error if it is rejected', () => {
    const error = new Error('It failed!');
    client.interceptors.request.handlers[0].rejected(error)
      .catch((rejection) => {
        expect(rejection).toBe(error);
      });
  });
});

describe('AuthenticatedAPIClient ensureCsrfToken request interceptor', () => {
  [
    /* isCsrfExempt, method, queueRequests, csrfTokens, expects, expectHeaderSet */
    [false, 'POST', false, {}, expectGetCsrfTokenToHaveBeenCalled, true],
    [false, 'POST', true, {}, expectGetCsrfTokenToNotHaveBeenCalled, true],
    [false, 'POST', false, { 'testserver.org': 'test-csrf-token' }, expectGetCsrfTokenToNotHaveBeenCalled, true],
    [true, 'POST', false, {}, expectGetCsrfTokenToNotHaveBeenCalled, false],
    [false, 'GET', false, {}, expectGetCsrfTokenToNotHaveBeenCalled, false],
    [true, 'GET', false, {}, expectGetCsrfTokenToNotHaveBeenCalled, false],
  ].forEach((mockValues) => {
    testCsrfTokenInterceptorFulfillment(...mockValues);
  });

  it('returns error if it is rejected', () => {
    const error = new Error('It failed!');
    client.interceptors.request.handlers[1].rejected(error)
      .catch((rejection) => {
        expect(rejection).toBe(error);
      });
  });
});

describe('AuthenticatedAPIClient response interceptor', () => {
  it('returns error if it fails with 401', () => {
    const errorResponse = { response: { status: 401, data: 'it failed' } };
    client.interceptors.response.handlers[0].rejected(errorResponse)
      .catch((promiseError) => {
        expect(promiseError).toBe(errorResponse);
      });
  });
  it('returns error if token refresh fails with 401', () => {
    const errorResponse = {
      response: {
        status: 401,
        data: 'it failed',
        config: { url: authConfig.refreshAccessTokenEndpoint },
      },
    };
    client.interceptors.response.handlers[0].rejected(errorResponse)
      .catch((promiseError) => {
        expect(promiseError).toBe(errorResponse);
      });
  });
  it('returns error if it fails with 403', () => {
    const errorResponse = { response: { status: 403, data: 'it failed' } };
    client.interceptors.response.handlers[0].rejected(errorResponse)
      .catch((promiseError) => {
        expect(promiseError).toBe(errorResponse);
      });
  });
  it('returns response if it is fulfilled', () => {
    const response = { data: 'It worked!' };
    const result = client.interceptors.response.handlers[0].fulfilled(response);
    expect(result).toBe(response);
  });
});
