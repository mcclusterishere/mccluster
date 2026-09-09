var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// wrangler-modules-watch:wrangler:modules-watch
var init_wrangler_modules_watch = __esm({
  "wrangler-modules-watch:wrangler:modules-watch"() {
    init_modules_watch_stub();
  }
});

// ../../../../../root/.npm/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/modules-watch-stub.js
var init_modules_watch_stub = __esm({
  "../../../../../root/.npm/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/modules-watch-stub.js"() {
    init_wrangler_modules_watch();
  }
});

// node_modules/@fal-ai/client/src/middleware.js
var require_middleware = __commonJS({
  "node_modules/@fal-ai/client/src/middleware.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    var __awaiter = exports && exports.__awaiter || function(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function(resolve) {
          resolve(value);
        });
      }
      __name(adopt, "adopt");
      return new (P || (P = Promise))(function(resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }
        __name(fulfilled, "fulfilled");
        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }
        __name(rejected, "rejected");
        function step(result2) {
          result2.done ? resolve(result2.value) : adopt(result2.value).then(fulfilled, rejected);
        }
        __name(step, "step");
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TARGET_URL_HEADER = void 0;
    exports.withMiddleware = withMiddleware;
    exports.withProxy = withProxy;
    function withMiddleware(...middlewares) {
      const isDefined = /* @__PURE__ */ __name((middleware) => typeof middleware === "function", "isDefined");
      return (config) => __awaiter(this, void 0, void 0, function* () {
        let currentConfig = Object.assign({}, config);
        for (const middleware of middlewares.filter(isDefined)) {
          currentConfig = yield middleware(currentConfig);
        }
        return currentConfig;
      });
    }
    __name(withMiddleware, "withMiddleware");
    exports.TARGET_URL_HEADER = "x-fal-target-url";
    function shouldProxy(when) {
      const env = {
        isBrowser: typeof window !== "undefined" && typeof window.document !== "undefined"
      };
      if (typeof when === "function") {
        return when(env);
      }
      if (when === "always") {
        return true;
      }
      return env.isBrowser;
    }
    __name(shouldProxy, "shouldProxy");
    function withProxy(config) {
      return (requestConfig) => {
        if (requestConfig.headers && exports.TARGET_URL_HEADER in requestConfig.headers) {
          return Promise.resolve(requestConfig);
        }
        if (!shouldProxy(config.when)) {
          return Promise.resolve(requestConfig);
        }
        return Promise.resolve(Object.assign(Object.assign({}, requestConfig), { url: config.targetUrl, headers: Object.assign(Object.assign({}, requestConfig.headers || {}), { [exports.TARGET_URL_HEADER]: requestConfig.url }) }));
      };
    }
    __name(withProxy, "withProxy");
  }
});

// node_modules/@fal-ai/client/src/headers.js
var require_headers = __commonJS({
  "node_modules/@fal-ai/client/src/headers.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.RUNNER_HINT_HEADER = exports.QUEUE_PRIORITY_HEADER = exports.REQUEST_TIMEOUT_TYPE_HEADER = exports.REQUEST_TIMEOUT_HEADER = exports.MIN_REQUEST_TIMEOUT_SECONDS = void 0;
    exports.validateTimeoutHeader = validateTimeoutHeader;
    exports.buildTimeoutHeaders = buildTimeoutHeaders;
    exports.MIN_REQUEST_TIMEOUT_SECONDS = 1;
    exports.REQUEST_TIMEOUT_HEADER = "x-fal-request-timeout";
    exports.REQUEST_TIMEOUT_TYPE_HEADER = "x-fal-request-timeout-type";
    exports.QUEUE_PRIORITY_HEADER = "x-fal-queue-priority";
    exports.RUNNER_HINT_HEADER = "x-fal-runner-hint";
    function validateTimeoutHeader(timeout) {
      if (typeof timeout !== "number" || isNaN(timeout)) {
        throw new Error(`Timeout must be a number, got ${timeout}`);
      }
      if (timeout <= exports.MIN_REQUEST_TIMEOUT_SECONDS) {
        throw new Error(`Timeout must be greater than ${exports.MIN_REQUEST_TIMEOUT_SECONDS} seconds`);
      }
      return timeout.toString();
    }
    __name(validateTimeoutHeader, "validateTimeoutHeader");
    function buildTimeoutHeaders(timeout) {
      if (timeout === void 0) {
        return {};
      }
      return {
        [exports.REQUEST_TIMEOUT_HEADER]: validateTimeoutHeader(timeout)
      };
    }
    __name(buildTimeoutHeaders, "buildTimeoutHeaders");
  }
});

// node_modules/@fal-ai/client/src/response.js
var require_response = __commonJS({
  "node_modules/@fal-ai/client/src/response.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    var __awaiter = exports && exports.__awaiter || function(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function(resolve) {
          resolve(value);
        });
      }
      __name(adopt, "adopt");
      return new (P || (P = Promise))(function(resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }
        __name(fulfilled, "fulfilled");
        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }
        __name(rejected, "rejected");
        function step(result2) {
          result2.done ? resolve(result2.value) : adopt(result2.value).then(fulfilled, rejected);
        }
        __name(step, "step");
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ValidationError = exports.ApiError = void 0;
    exports.defaultResponseHandler = defaultResponseHandler;
    exports.resultResponseHandler = resultResponseHandler;
    var headers_1 = require_headers();
    var REQUEST_ID_HEADER = "x-fal-request-id";
    var ApiError = class extends Error {
      static {
        __name(this, "ApiError");
      }
      constructor({ message, status, body, requestId, timeoutType }) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.body = body;
        this.requestId = requestId || "";
        this.timeoutType = timeoutType;
      }
      /**
       * Returns true if this error was caused by a user-specified timeout
       * (via startTimeout parameter). These errors should NOT be retried.
       */
      get isUserTimeout() {
        return this.status === 504 && this.timeoutType === "user";
      }
    };
    exports.ApiError = ApiError;
    var ValidationError = class extends ApiError {
      static {
        __name(this, "ValidationError");
      }
      constructor(args) {
        super(args);
        this.name = "ValidationError";
      }
      get fieldErrors() {
        if (typeof this.body.detail === "string") {
          return [
            {
              loc: ["body"],
              msg: this.body.detail,
              type: "value_error"
            }
          ];
        }
        return this.body.detail || [];
      }
      getFieldErrors(field) {
        return this.fieldErrors.filter((error) => error.loc[error.loc.length - 1] === field);
      }
    };
    exports.ValidationError = ValidationError;
    function defaultResponseHandler(response) {
      return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const { status, statusText } = response;
        const contentType = (_a = response.headers.get("Content-Type")) !== null && _a !== void 0 ? _a : "";
        const requestId = response.headers.get(REQUEST_ID_HEADER) || void 0;
        const timeoutType = response.headers.get(headers_1.REQUEST_TIMEOUT_TYPE_HEADER) || void 0;
        if (!response.ok) {
          if (contentType.includes("application/json")) {
            const body = yield response.json();
            const ErrorType = status === 422 ? ValidationError : ApiError;
            throw new ErrorType({
              message: body.message || statusText,
              status,
              body,
              requestId,
              timeoutType
            });
          }
          throw new ApiError({
            message: `HTTP ${status}: ${statusText}`,
            status,
            requestId,
            timeoutType
          });
        }
        if (contentType.includes("application/json")) {
          return response.json();
        }
        if (contentType.includes("text/html")) {
          return response.text();
        }
        if (contentType.includes("application/octet-stream")) {
          return response.arrayBuffer();
        }
        return response.text();
      });
    }
    __name(defaultResponseHandler, "defaultResponseHandler");
    function resultResponseHandler(response) {
      return __awaiter(this, void 0, void 0, function* () {
        const data = yield defaultResponseHandler(response);
        return {
          data,
          requestId: response.headers.get(REQUEST_ID_HEADER) || ""
        };
      });
    }
    __name(resultResponseHandler, "resultResponseHandler");
  }
});

// node_modules/@fal-ai/client/src/utils.js
var require_utils = __commonJS({
  "node_modules/@fal-ai/client/src/utils.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    var __awaiter = exports && exports.__awaiter || function(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function(resolve) {
          resolve(value);
        });
      }
      __name(adopt, "adopt");
      return new (P || (P = Promise))(function(resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }
        __name(fulfilled, "fulfilled");
        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }
        __name(rejected, "rejected");
        function step(result2) {
          result2.done ? resolve(result2.value) : adopt(result2.value).then(fulfilled, rejected);
        }
        __name(step, "step");
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ensureEndpointIdFormat = ensureEndpointIdFormat;
    exports.parseEndpointId = parseEndpointId;
    exports.resolveEndpointPath = resolveEndpointPath;
    exports.isValidUrl = isValidUrl;
    exports.throttle = throttle;
    exports.isReact = isReact;
    exports.isPlainObject = isPlainObject;
    exports.sleep = sleep;
    function ensureEndpointIdFormat(id) {
      const parts = id.split("/");
      if (parts.length > 1) {
        return id;
      }
      const [, appOwner, appId] = /^([0-9]+)-([a-zA-Z0-9-]+)$/.exec(id) || [];
      if (appOwner && appId) {
        return `${appOwner}/${appId}`;
      }
      throw new Error(`Invalid app id: ${id}. Must be in the format <appOwner>/<appId>`);
    }
    __name(ensureEndpointIdFormat, "ensureEndpointIdFormat");
    var ENDPOINT_NAMESPACES = ["workflows", "comfy"];
    function parseEndpointId(id) {
      const normalizedId = ensureEndpointIdFormat(id);
      const parts = normalizedId.split("/");
      if (ENDPOINT_NAMESPACES.includes(parts[0])) {
        return {
          owner: parts[1],
          alias: parts[2],
          path: parts.slice(3).join("/") || void 0,
          namespace: parts[0]
        };
      }
      return {
        owner: parts[0],
        alias: parts[1],
        path: parts.slice(2).join("/") || void 0
      };
    }
    __name(parseEndpointId, "parseEndpointId");
    function resolveEndpointPath(app, path, defaultPath) {
      if (path) {
        return `/${path.replace(/^\/+/, "")}`;
      }
      if (app.endsWith(defaultPath)) {
        return void 0;
      }
      return defaultPath;
    }
    __name(resolveEndpointPath, "resolveEndpointPath");
    function isValidUrl(url) {
      try {
        const { host } = new URL(url);
        return /(fal\.(ai|run))$/.test(host);
      } catch (_) {
        return false;
      }
    }
    __name(isValidUrl, "isValidUrl");
    function throttle(func, limit, leading = false) {
      let lastFunc;
      let lastRan;
      return (...args) => {
        if (!lastRan && leading) {
          func(...args);
          lastRan = Date.now();
        } else {
          if (lastFunc) {
            clearTimeout(lastFunc);
          }
          lastFunc = setTimeout(() => {
            if (Date.now() - lastRan >= limit) {
              func(...args);
              lastRan = Date.now();
            }
          }, limit - (Date.now() - lastRan));
        }
      };
    }
    __name(throttle, "throttle");
    var isRunningInReact;
    function isReact() {
      if (isRunningInReact === void 0) {
        const stack = new Error().stack;
        isRunningInReact = !!stack && (stack.includes("node_modules/react-dom/") || stack.includes("node_modules/next/"));
      }
      return isRunningInReact;
    }
    __name(isReact, "isReact");
    function isPlainObject(value) {
      return !!value && Object.getPrototypeOf(value) === Object.prototype;
    }
    __name(isPlainObject, "isPlainObject");
    function sleep(ms) {
      return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve) => setTimeout(resolve, ms));
      });
    }
    __name(sleep, "sleep");
  }
});

// node_modules/@fal-ai/client/src/retry.js
var require_retry = __commonJS({
  "node_modules/@fal-ai/client/src/retry.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    var __awaiter = exports && exports.__awaiter || function(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function(resolve) {
          resolve(value);
        });
      }
      __name(adopt, "adopt");
      return new (P || (P = Promise))(function(resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }
        __name(fulfilled, "fulfilled");
        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }
        __name(rejected, "rejected");
        function step(result2) {
          result2.done ? resolve(result2.value) : adopt(result2.value).then(fulfilled, rejected);
        }
        __name(step, "step");
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DEFAULT_RETRY_OPTIONS = exports.DEFAULT_RETRYABLE_STATUS_CODES = void 0;
    exports.isRetryableNetworkError = isRetryableNetworkError;
    exports.isRetryableError = isRetryableError;
    exports.calculateBackoffDelay = calculateBackoffDelay;
    exports.executeWithRetry = executeWithRetry;
    var response_1 = require_response();
    var utils_1 = require_utils();
    exports.DEFAULT_RETRYABLE_STATUS_CODES = [429, 502, 503, 504];
    exports.DEFAULT_RETRY_OPTIONS = {
      maxRetries: 3,
      baseDelay: 1e3,
      maxDelay: 3e4,
      backoffMultiplier: 2,
      retryableStatusCodes: exports.DEFAULT_RETRYABLE_STATUS_CODES,
      enableJitter: true
    };
    var RETRYABLE_NETWORK_ERROR_CODES = /* @__PURE__ */ new Set([
      "ECONNABORTED",
      "ECONNREFUSED",
      "ECONNRESET",
      "EAI_AGAIN",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ENOTFOUND",
      "EPIPE",
      "ETIMEDOUT",
      "UND_ERR_BODY_TIMEOUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_SOCKET"
    ]);
    function isRetryableNetworkError(error) {
      if (!error || typeof error !== "object") {
        return false;
      }
      const seen = /* @__PURE__ */ new Set();
      let current = error;
      let sawTransportShape = false;
      while (current && typeof current === "object" && !seen.has(current)) {
        seen.add(current);
        const name = current.name;
        if (name === "AbortError" || name === "TimeoutError") {
          return false;
        }
        const code = current.code;
        if (typeof code === "string" && RETRYABLE_NETWORK_ERROR_CODES.has(code)) {
          sawTransportShape = true;
        }
        current = current.cause;
      }
      if (sawTransportShape) {
        return true;
      }
      if (error instanceof TypeError && typeof error.message === "string" && /fetch failed/i.test(error.message)) {
        return true;
      }
      return false;
    }
    __name(isRetryableNetworkError, "isRetryableNetworkError");
    function isRetryableError(error, retryableStatusCodes) {
      if (error instanceof response_1.ApiError) {
        if (error.isUserTimeout) {
          return false;
        }
        return retryableStatusCodes.includes(error.status);
      }
      return isRetryableNetworkError(error);
    }
    __name(isRetryableError, "isRetryableError");
    function calculateBackoffDelay(attempt, baseDelay, maxDelay, backoffMultiplier, enableJitter) {
      const exponentialDelay = Math.min(baseDelay * Math.pow(backoffMultiplier, attempt), maxDelay);
      if (enableJitter) {
        const jitter = 0.25 * exponentialDelay * (Math.random() * 2 - 1);
        return Math.max(0, exponentialDelay + jitter);
      }
      return exponentialDelay;
    }
    __name(calculateBackoffDelay, "calculateBackoffDelay");
    function executeWithRetry(operation, options, onRetry) {
      return __awaiter(this, void 0, void 0, function* () {
        const metrics = {
          totalAttempts: 0,
          totalDelay: 0
        };
        let lastError;
        for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
          metrics.totalAttempts++;
          try {
            const result2 = yield operation();
            return { result: result2, metrics };
          } catch (error) {
            lastError = error;
            metrics.lastError = error;
            if (attempt === options.maxRetries || !isRetryableError(error, options.retryableStatusCodes)) {
              throw error;
            }
            const delay = calculateBackoffDelay(attempt, options.baseDelay, options.maxDelay, options.backoffMultiplier, options.enableJitter);
            metrics.totalDelay += delay;
            if (onRetry) {
              onRetry(attempt + 1, error, delay);
            }
            yield (0, utils_1.sleep)(delay);
          }
        }
        throw lastError;
      });
    }
    __name(executeWithRetry, "executeWithRetry");
  }
});

// node_modules/@fal-ai/client/package.json
var require_package = __commonJS({
  "node_modules/@fal-ai/client/package.json"(exports, module) {
    module.exports = {
      name: "@fal-ai/client",
      description: "The fal.ai client for JavaScript and TypeScript",
      version: "1.10.1",
      license: "MIT",
      repository: {
        type: "git",
        url: "https://github.com/fal-ai/fal-js.git",
        directory: "libs/client"
      },
      keywords: [
        "fal",
        "client",
        "ai",
        "ml",
        "typescript"
      ],
      exports: {
        ".": "./src/index.js",
        "./endpoints": "./src/types/endpoints.js"
      },
      typesVersions: {
        "*": {
          endpoints: [
            "src/types/endpoints.d.ts"
          ]
        }
      },
      main: "./src/index.js",
      types: "./src/index.d.ts",
      dependencies: {
        "@msgpack/msgpack": "^3.0.0-beta2",
        "eventsource-parser": "^1.1.2",
        robot3: "^0.4.1"
      },
      engines: {
        node: ">=18.0.0"
      },
      type: "commonjs"
    };
  }
});

// node_modules/@fal-ai/client/src/runtime.js
var require_runtime = __commonJS({
  "node_modules/@fal-ai/client/src/runtime.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isBrowser = isBrowser;
    exports.getUserAgent = getUserAgent;
    function isBrowser() {
      return typeof window !== "undefined" && typeof window.document !== "undefined";
    }
    __name(isBrowser, "isBrowser");
    var memoizedUserAgent = null;
    function getUserAgent() {
      if (memoizedUserAgent !== null) {
        return memoizedUserAgent;
      }
      const packageInfo = require_package();
      memoizedUserAgent = `${packageInfo.name}/${packageInfo.version}`;
      return memoizedUserAgent;
    }
    __name(getUserAgent, "getUserAgent");
  }
});

// node_modules/@fal-ai/client/src/config.js
var require_config = __commonJS({
  "node_modules/@fal-ai/client/src/config.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.credentialsFromEnv = void 0;
    exports.resolveDefaultFetch = resolveDefaultFetch;
    exports.createConfig = createConfig;
    exports.getRestApiUrl = getRestApiUrl;
    var middleware_1 = require_middleware();
    var response_1 = require_response();
    var retry_1 = require_retry();
    var runtime_1 = require_runtime();
    function resolveDefaultFetch() {
      if (typeof fetch === "undefined") {
        throw new Error("Your environment does not support fetch. Please provide your own fetch implementation.");
      }
      return fetch;
    }
    __name(resolveDefaultFetch, "resolveDefaultFetch");
    function hasEnvVariables() {
      return typeof process !== "undefined" && process.env && (typeof process.env.FAL_KEY !== "undefined" || typeof process.env.FAL_KEY_ID !== "undefined" && typeof process.env.FAL_KEY_SECRET !== "undefined");
    }
    __name(hasEnvVariables, "hasEnvVariables");
    var credentialsFromEnv = /* @__PURE__ */ __name(() => {
      if (!hasEnvVariables()) {
        return void 0;
      }
      if (typeof process.env.FAL_KEY !== "undefined") {
        return process.env.FAL_KEY;
      }
      return process.env.FAL_KEY_ID ? `${process.env.FAL_KEY_ID}:${process.env.FAL_KEY_SECRET}` : void 0;
    }, "credentialsFromEnv");
    exports.credentialsFromEnv = credentialsFromEnv;
    var DEFAULT_CONFIG = {
      credentials: exports.credentialsFromEnv,
      suppressLocalCredentialsWarning: false,
      requestMiddleware: /* @__PURE__ */ __name((request) => Promise.resolve(request), "requestMiddleware"),
      responseHandler: response_1.defaultResponseHandler,
      retry: retry_1.DEFAULT_RETRY_OPTIONS
    };
    function createConfig(config) {
      var _a;
      let configuration = Object.assign(Object.assign(Object.assign({}, DEFAULT_CONFIG), config), {
        fetch: (_a = config.fetch) !== null && _a !== void 0 ? _a : resolveDefaultFetch(),
        // Merge retry configuration with defaults
        retry: Object.assign(Object.assign({}, retry_1.DEFAULT_RETRY_OPTIONS), config.retry || {})
      });
      if (config.proxyUrl) {
        const proxy = typeof config.proxyUrl === "string" ? { url: config.proxyUrl } : config.proxyUrl;
        configuration = Object.assign(Object.assign({}, configuration), { requestMiddleware: (0, middleware_1.withMiddleware)(configuration.requestMiddleware, (0, middleware_1.withProxy)({ targetUrl: proxy.url, when: proxy.when })) });
      }
      const { credentials: resolveCredentials, suppressLocalCredentialsWarning } = configuration;
      const credentials = typeof resolveCredentials === "function" ? resolveCredentials() : resolveCredentials;
      if ((0, runtime_1.isBrowser)() && credentials && !suppressLocalCredentialsWarning) {
        console.warn("The fal credentials are exposed in the browser's environment. That's not recommended for production use cases.");
      }
      return configuration;
    }
    __name(createConfig, "createConfig");
    function getRestApiUrl() {
      return "https://rest.fal.ai";
    }
    __name(getRestApiUrl, "getRestApiUrl");
  }
});

// node_modules/@fal-ai/client/src/request.js
var require_request = __commonJS({
  "node_modules/@fal-ai/client/src/request.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    var __awaiter = exports && exports.__awaiter || function(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function(resolve) {
          resolve(value);
        });
      }
      __name(adopt, "adopt");
      return new (P || (P = Promise))(function(resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }
        __name(fulfilled, "fulfilled");
        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }
        __name(rejected, "rejected");
        function step(result2) {
          result2.done ? resolve(result2.value) : adopt(result2.value).then(fulfilled, rejected);
        }
        __name(step, "step");
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
    var __rest = exports && exports.__rest || function(s, e) {
      var t = {};
      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
      if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
          if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
            t[p[i]] = s[p[i]];
        }
      return t;
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.dispatchRequest = dispatchRequest;
    exports.buildUrl = buildUrl;
    var retry_1 = require_retry();
    var runtime_1 = require_runtime();
    var utils_1 = require_utils();
    var isCloudflareWorkers = typeof navigator !== "undefined" && (navigator === null || navigator === void 0 ? void 0 : "Cloudflare-Workers") === "Cloudflare-Workers";
    function dispatchRequest(params) {
      return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const { targetUrl, input, config, options = {} } = params;
        const { credentials: credentialsValue, requestMiddleware, responseHandler, fetch: fetch2 } = config;
        const retryOptions = Object.assign(Object.assign({}, config.retry), options.retry || {});
        const executeRequest = /* @__PURE__ */ __name(() => __awaiter(this, void 0, void 0, function* () {
          var _a2, _b, _c;
          const userAgent = (0, runtime_1.isBrowser)() ? {} : { "User-Agent": (0, runtime_1.getUserAgent)() };
          const credentials = typeof credentialsValue === "function" ? credentialsValue() : credentialsValue;
          const { method, url, headers: headers7 } = yield requestMiddleware({
            method: ((_b = (_a2 = params.method) !== null && _a2 !== void 0 ? _a2 : options.method) !== null && _b !== void 0 ? _b : "post").toUpperCase(),
            url: targetUrl,
            headers: params.headers
          });
          const authHeader = credentials ? { Authorization: `Key ${credentials}` } : {};
          const requestHeaders = Object.assign(Object.assign(Object.assign(Object.assign({}, authHeader), { Accept: "application/json", "Content-Type": "application/json" }), userAgent), headers7 !== null && headers7 !== void 0 ? headers7 : {});
          const { responseHandler: customResponseHandler, retry: _ } = options, requestInit = __rest(options, ["responseHandler", "retry"]);
          const response = yield fetch2(url, Object.assign(Object.assign(Object.assign(Object.assign({}, requestInit), { method, headers: Object.assign(Object.assign({}, requestHeaders), (_c = requestInit.headers) !== null && _c !== void 0 ? _c : {}) }), !isCloudflareWorkers && { mode: "cors" }), { signal: options.signal, body: method.toLowerCase() !== "get" && input ? JSON.stringify(input) : void 0 }));
          const handleResponse = customResponseHandler !== null && customResponseHandler !== void 0 ? customResponseHandler : responseHandler;
          return yield handleResponse(response);
        }), "executeRequest");
        let lastError;
        for (let attempt = 0; attempt <= retryOptions.maxRetries; attempt++) {
          try {
            return yield executeRequest();
          } catch (error) {
            lastError = error;
            const shouldNotRetry = attempt === retryOptions.maxRetries || !(0, retry_1.isRetryableError)(error, retryOptions.retryableStatusCodes) || ((_a = options.signal) === null || _a === void 0 ? void 0 : _a.aborted);
            if (shouldNotRetry) {
              throw error;
            }
            const delay = (0, retry_1.calculateBackoffDelay)(attempt, retryOptions.baseDelay, retryOptions.maxDelay, retryOptions.backoffMultiplier, retryOptions.enableJitter);
            yield (0, utils_1.sleep)(delay);
          }
        }
        throw lastError;
      });
    }
    __name(dispatchRequest, "dispatchRequest");
    function buildUrl(id, options = {}) {
      var _a, _b;
      const method = ((_a = options.method) !== null && _a !== void 0 ? _a : "post").toLowerCase();
      const path = ((_b = options.path) !== null && _b !== void 0 ? _b : "").replace(/^\//, "").replace(/\/{2,}/, "/");
      const input = options.input;
      const params = Object.assign(Object.assign({}, options.query || {}), method === "get" ? input : {});
      const queryParams2 = Object.keys(params).length > 0 ? `?${new URLSearchParams(params).toString()}` : "";
      if ((0, utils_1.isValidUrl)(id)) {
        const url2 = id.endsWith("/") ? id : `${id}/`;
        return `${url2}${path}${queryParams2}`;
      }
      const appId = (0, utils_1.ensureEndpointIdFormat)(id);
      const subdomain = options.subdomain ? `${options.subdomain}.` : "";
      const url = `https://${subdomain}fal.run/${appId}/${path}`;
      return `${url.replace(/\/$/, "")}${queryParams2}`;
    }
    __name(buildUrl, "buildUrl");
  }
});

// node_modules/@fal-ai/client/src/storage.js
var require_storage = __commonJS({
  "node_modules/@fal-ai/client/src/storage.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    var __awaiter = exports && exports.__awaiter || function(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function(resolve) {
          resolve(value);
        });
      }
      __name(adopt, "adopt");
      return new (P || (P = Promise))(function(resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }
        __name(fulfilled, "fulfilled");
        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }
        __name(rejected, "rejected");
        function step(result2) {
          result2.done ? resolve(result2.value) : adopt(result2.value).then(fulfilled, rejected);
        }
        __name(step, "step");
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.OBJECT_LIFECYCYLE_PREFERENCE_HEADER = void 0;
    exports.getExpirationDurationSeconds = getExpirationDurationSeconds;
    exports.buildObjectLifecycleHeaders = buildObjectLifecycleHeaders;
    exports.createStorageClient = createStorageClient;
    var config_1 = require_config();
    var request_1 = require_request();
    var utils_1 = require_utils();
    exports.OBJECT_LIFECYCYLE_PREFERENCE_HEADER = "x-fal-object-lifecycle-preference";
    var EXPIRATION_VALUES = {
      never: void 0,
      immediate: 60,
      "1h": 3600,
      "1d": 86400,
      "7d": 604800,
      "30d": 2592e3,
      "1y": 31536e3
    };
    function getExpirationDurationSeconds(lifecycle) {
      const { expiresIn } = lifecycle;
      if (expiresIn === void 0) {
        return void 0;
      }
      return typeof expiresIn === "number" ? expiresIn : EXPIRATION_VALUES[expiresIn];
    }
    __name(getExpirationDurationSeconds, "getExpirationDurationSeconds");
    function buildUploadLifecycleConfig(lifecycle) {
      if (!lifecycle) {
        return void 0;
      }
      const expirationDurationSeconds = getExpirationDurationSeconds(lifecycle);
      const lifecycleConfig = {};
      if (expirationDurationSeconds !== void 0) {
        lifecycleConfig.expiration_duration_seconds = expirationDurationSeconds;
      }
      if (lifecycle.initialAcl !== void 0) {
        lifecycleConfig.initial_acl = lifecycle.initialAcl;
      }
      return Object.keys(lifecycleConfig).length > 0 ? lifecycleConfig : void 0;
    }
    __name(buildUploadLifecycleConfig, "buildUploadLifecycleConfig");
    function buildObjectLifecycleHeaders(lifecycle) {
      const lifecycleConfig = buildUploadLifecycleConfig(lifecycle);
      if (!lifecycleConfig) {
        return {};
      }
      return {
        [exports.OBJECT_LIFECYCYLE_PREFERENCE_HEADER]: JSON.stringify(lifecycleConfig)
      };
    }
    __name(buildObjectLifecycleHeaders, "buildObjectLifecycleHeaders");
    function getExtensionFromContentType(contentType) {
      var _a;
      const [, fileType] = contentType.split("/");
      return (_a = fileType.split(/[-;]/)[0]) !== null && _a !== void 0 ? _a : "bin";
    }
    __name(getExtensionFromContentType, "getExtensionFromContentType");
    function initiateUpload(file, config, contentType, lifecycle) {
      return __awaiter(this, void 0, void 0, function* () {
        const filename = file.name || `${Date.now()}.${getExtensionFromContentType(contentType)}`;
        const headers7 = {};
        const lifecycleConfig = buildUploadLifecycleConfig(lifecycle);
        if (lifecycleConfig) {
          headers7["X-Fal-Object-Lifecycle"] = JSON.stringify(lifecycleConfig);
        }
        return yield (0, request_1.dispatchRequest)({
          method: "POST",
          // NOTE: We want to test V3 without making it the default at the API level
          targetUrl: `${(0, config_1.getRestApiUrl)()}/storage/upload/initiate?storage_type=fal-cdn-v3`,
          input: {
            content_type: contentType,
            file_name: filename
          },
          config,
          headers: headers7
        });
      });
    }
    __name(initiateUpload, "initiateUpload");
    function initiateMultipartUpload(file, config, contentType, lifecycle) {
      return __awaiter(this, void 0, void 0, function* () {
        const filename = file.name || `${Date.now()}.${getExtensionFromContentType(contentType)}`;
        const headers7 = {};
        const lifecycleConfig = buildUploadLifecycleConfig(lifecycle);
        if (lifecycleConfig) {
          headers7["X-Fal-Object-Lifecycle"] = JSON.stringify(lifecycleConfig);
        }
        return yield (0, request_1.dispatchRequest)({
          method: "POST",
          targetUrl: `${(0, config_1.getRestApiUrl)()}/storage/upload/initiate-multipart?storage_type=fal-cdn-v3`,
          input: {
            content_type: contentType,
            file_name: filename
          },
          config,
          headers: headers7
        });
      });
    }
    __name(initiateMultipartUpload, "initiateMultipartUpload");
    function partUploadRetries(uploadUrl_1, chunk_1, config_2) {
      return __awaiter(this, arguments, void 0, function* (uploadUrl, chunk, config, tries = 3) {
        if (tries === 0) {
          throw new Error("Part upload failed, retries exhausted");
        }
        const { fetch: fetch2, responseHandler } = config;
        try {
          const response = yield fetch2(uploadUrl, {
            method: "PUT",
            body: chunk
          });
          return yield responseHandler(response);
        } catch (error) {
          return yield partUploadRetries(uploadUrl, chunk, config, tries - 1);
        }
      });
    }
    __name(partUploadRetries, "partUploadRetries");
    function multipartUpload(file, config, lifecycle) {
      return __awaiter(this, void 0, void 0, function* () {
        const { fetch: fetch2, responseHandler } = config;
        const contentType = file.type || "application/octet-stream";
        const { upload_url: uploadUrl, file_url: url } = yield initiateMultipartUpload(file, config, contentType, lifecycle);
        const chunkSize = 10 * 1024 * 1024;
        const chunks = Math.ceil(file.size / chunkSize);
        const parsedUrl = new URL(uploadUrl);
        const responses = [];
        for (let i = 0; i < chunks; i++) {
          const start = i * chunkSize;
          const end = Math.min(start + chunkSize, file.size);
          const chunk = file.slice(start, end);
          const partNumber = i + 1;
          const partUploadUrl = `${parsedUrl.origin}${parsedUrl.pathname}/${partNumber}${parsedUrl.search}`;
          responses.push(yield partUploadRetries(partUploadUrl, chunk, config));
        }
        const completeUrl = `${parsedUrl.origin}${parsedUrl.pathname}/complete${parsedUrl.search}`;
        const response = yield fetch2(completeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            parts: responses.map((mpart) => ({
              partNumber: mpart.partNumber,
              etag: mpart.etag
            }))
          })
        });
        yield responseHandler(response);
        return url;
      });
    }
    __name(multipartUpload, "multipartUpload");
    function createStorageClient({ config }) {
      const ref = {
        upload: /* @__PURE__ */ __name((file, options) => __awaiter(this, void 0, void 0, function* () {
          const lifecycle = options === null || options === void 0 ? void 0 : options.lifecycle;
          if (file.size > 90 * 1024 * 1024) {
            return yield multipartUpload(file, config, lifecycle);
          }
          const contentType = file.type || "application/octet-stream";
          const { fetch: fetch2, responseHandler } = config;
          const { upload_url: uploadUrl, file_url: url } = yield initiateUpload(file, config, contentType, lifecycle);
          const response = yield fetch2(uploadUrl, {
            method: "PUT",
            body: file,
            headers: {
              "Content-Type": file.type || "application/octet-stream"
            }
          });
          yield responseHandler(response);
          return url;
        }), "upload"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transformInput: /* @__PURE__ */ __name((input) => __awaiter(this, void 0, void 0, function* () {
          if (Array.isArray(input)) {
            return Promise.all(input.map((item) => ref.transformInput(item)));
          } else if (input instanceof Blob) {
            return yield ref.upload(input);
          } else if ((0, utils_1.isPlainObject)(input)) {
            const inputObject = input;
            const promises = Object.entries(inputObject).map((_a) => __awaiter(this, [_a], void 0, function* ([key, value]) {
              return [key, yield ref.transformInput(value)];
            }));
            const results = yield Promise.all(promises);
            return Object.fromEntries(results);
          }
          return input;
        }), "transformInput")
      };
      return ref;
    }
    __name(createStorageClient, "createStorageClient");
  }
});

// node_modules/eventsource-parser/dist/index.cjs
var require_dist = __commonJS({
  "node_modules/eventsource-parser/dist/index.cjs"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    function createParser(onParse) {
      let isFirstChunk;
      let buffer;
      let startingPosition;
      let startingFieldLength;
      let eventId;
      let eventName;
      let data;
      reset();
      return {
        feed,
        reset
      };
      function reset() {
        isFirstChunk = true;
        buffer = "";
        startingPosition = 0;
        startingFieldLength = -1;
        eventId = void 0;
        eventName = void 0;
        data = "";
      }
      __name(reset, "reset");
      function feed(chunk) {
        buffer = buffer ? buffer + chunk : chunk;
        if (isFirstChunk && hasBom(buffer)) {
          buffer = buffer.slice(BOM.length);
        }
        isFirstChunk = false;
        const length = buffer.length;
        let position = 0;
        let discardTrailingNewline = false;
        while (position < length) {
          if (discardTrailingNewline) {
            if (buffer[position] === "\n") {
              ++position;
            }
            discardTrailingNewline = false;
          }
          let lineLength = -1;
          let fieldLength = startingFieldLength;
          let character;
          for (let index = startingPosition; lineLength < 0 && index < length; ++index) {
            character = buffer[index];
            if (character === ":" && fieldLength < 0) {
              fieldLength = index - position;
            } else if (character === "\r") {
              discardTrailingNewline = true;
              lineLength = index - position;
            } else if (character === "\n") {
              lineLength = index - position;
            }
          }
          if (lineLength < 0) {
            startingPosition = length - position;
            startingFieldLength = fieldLength;
            break;
          } else {
            startingPosition = 0;
            startingFieldLength = -1;
          }
          parseEventStreamLine(buffer, position, fieldLength, lineLength);
          position += lineLength + 1;
        }
        if (position === length) {
          buffer = "";
        } else if (position > 0) {
          buffer = buffer.slice(position);
        }
      }
      __name(feed, "feed");
      function parseEventStreamLine(lineBuffer, index, fieldLength, lineLength) {
        if (lineLength === 0) {
          if (data.length > 0) {
            onParse({
              type: "event",
              id: eventId,
              event: eventName || void 0,
              data: data.slice(0, -1)
              // remove trailing newline
            });
            data = "";
            eventId = void 0;
          }
          eventName = void 0;
          return;
        }
        const noValue = fieldLength < 0;
        const field = lineBuffer.slice(index, index + (noValue ? lineLength : fieldLength));
        let step = 0;
        if (noValue) {
          step = lineLength;
        } else if (lineBuffer[index + fieldLength + 1] === " ") {
          step = fieldLength + 2;
        } else {
          step = fieldLength + 1;
        }
        const position = index + step;
        const valueLength = lineLength - step;
        const value = lineBuffer.slice(position, position + valueLength).toString();
        if (field === "data") {
          data += value ? "".concat(value, "\n") : "\n";
        } else if (field === "event") {
          eventName = value;
        } else if (field === "id" && !value.includes("\0")) {
          eventId = value;
        } else if (field === "retry") {
          const retry = parseInt(value, 10);
          if (!Number.isNaN(retry)) {
            onParse({
              type: "reconnect-interval",
              value: retry
            });
          }
        }
      }
      __name(parseEventStreamLine, "parseEventStreamLine");
    }
    __name(createParser, "createParser");
    var BOM = [239, 187, 191];
    function hasBom(buffer) {
      return BOM.every((charCode, index) => buffer.charCodeAt(index) === charCode);
    }
    __name(hasBom, "hasBom");
    exports.createParser = createParser;
  }
});

// node_modules/@fal-ai/client/src/auth.js
var require_auth = __commonJS({
  "node_modules/@fal-ai/client/src/auth.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    var __awaiter = exports && exports.__awaiter || function(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function(resolve) {
          resolve(value);
        });
      }
      __name(adopt, "adopt");
      return new (P || (P = Promise))(function(resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }
        __name(fulfilled, "fulfilled");
        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }
        __name(rejected, "rejected");
        function step(result2) {
          result2.done ? resolve(result2.value) : adopt(result2.value).then(fulfilled, rejected);
        }
        __name(step, "step");
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TOKEN_EXPIRATION_SECONDS = void 0;
    exports.getTemporaryAuthToken = getTemporaryAuthToken;
    var config_1 = require_config();
    var request_1 = require_request();
    var utils_1 = require_utils();
    exports.TOKEN_EXPIRATION_SECONDS = 120;
    function getTemporaryAuthToken(app, config) {
      return __awaiter(this, void 0, void 0, function* () {
        const appId = (0, utils_1.parseEndpointId)(app);
        const token = yield (0, request_1.dispatchRequest)({
          method: "POST",
          targetUrl: `${(0, config_1.getRestApiUrl)()}/tokens/`,
          config,
          input: {
            allowed_apps: [appId.alias],
            token_expiration: exports.TOKEN_EXPIRATION_SECONDS
          }
        });
        if (typeof token !== "string" && token["detail"]) {
          return token["detail"];
        }
        return token;
      });
    }
    __name(getTemporaryAuthToken, "getTemporaryAuthToken");
  }
});

// node_modules/@fal-ai/client/src/streaming.js
var require_streaming = __commonJS({
  "node_modules/@fal-ai/client/src/streaming.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    var __awaiter = exports && exports.__awaiter || function(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function(resolve) {
          resolve(value);
        });
      }
      __name(adopt, "adopt");
      return new (P || (P = Promise))(function(resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }
        __name(fulfilled, "fulfilled");
        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }
        __name(rejected, "rejected");
        function step(result2) {
          result2.done ? resolve(result2.value) : adopt(result2.value).then(fulfilled, rejected);
        }
        __name(step, "step");
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
    var __await = exports && exports.__await || function(v) {
      return this instanceof __await ? (this.v = v, this) : new __await(v);
    };
    var __asyncGenerator = exports && exports.__asyncGenerator || function(thisArg, _arguments, generator) {
      if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
      var g = generator.apply(thisArg, _arguments || []), i, q = [];
      return i = {}, verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function() {
        return this;
      }, i;
      function awaitReturn(f) {
        return function(v) {
          return Promise.resolve(v).then(f, reject);
        };
      }
      __name(awaitReturn, "awaitReturn");
      function verb(n, f) {
        if (g[n]) {
          i[n] = function(v) {
            return new Promise(function(a, b) {
              q.push([n, v, a, b]) > 1 || resume(n, v);
            });
          };
          if (f) i[n] = f(i[n]);
        }
      }
      __name(verb, "verb");
      function resume(n, v) {
        try {
          step(g[n](v));
        } catch (e) {
          settle(q[0][3], e);
        }
      }
      __name(resume, "resume");
      function step(r) {
        r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r);
      }
      __name(step, "step");
      function fulfill(value) {
        resume("next", value);
      }
      __name(fulfill, "fulfill");
      function reject(value) {
        resume("throw", value);
      }
      __name(reject, "reject");
      function settle(f, v) {
        if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]);
      }
      __name(settle, "settle");
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.FalStream = void 0;
    exports.createStreamingClient = createStreamingClient;
    var eventsource_parser_1 = require_dist();
    var auth_1 = require_auth();
    var request_1 = require_request();
    var response_1 = require_response();
    var utils_1 = require_utils();
    var CONTENT_TYPE_EVENT_STREAM = "text/event-stream";
    var EVENT_STREAM_TIMEOUT = 15 * 1e3;
    var FalStream = class {
      static {
        __name(this, "FalStream");
      }
      constructor(endpointId, config, options) {
        var _a;
        this.listeners = /* @__PURE__ */ new Map();
        this.buffer = [];
        this.currentData = void 0;
        this.lastEventTimestamp = 0;
        this.streamClosed = false;
        this._requestId = null;
        this.abortController = new AbortController();
        this.start = () => __awaiter(this, void 0, void 0, function* () {
          var _a2, _b, _c;
          const { endpointId: endpointId2, options: options2 } = this;
          const { input, method = "post", connectionMode = "server", tokenProvider } = options2;
          try {
            if (connectionMode === "client") {
              const appId = (0, utils_1.ensureEndpointIdFormat)(endpointId2);
              const resolvedPath = (_a2 = (0, utils_1.resolveEndpointPath)(endpointId2, void 0, "/stream")) !== null && _a2 !== void 0 ? _a2 : "";
              const fetchToken = tokenProvider ? () => tokenProvider(`${appId}${resolvedPath}`) : () => {
                console.warn('[fal.stream] Using the default token provider is deprecated. Please provide a `tokenProvider` function when using `connectionMode: "client"`. See https://docs.fal.ai/fal-client/authentication for more information.');
                return (0, auth_1.getTemporaryAuthToken)(endpointId2, this.config);
              };
              const token = yield fetchToken();
              const { fetch: fetch2 } = this.config;
              const parsedUrl = new URL(this.url);
              parsedUrl.searchParams.set("fal_jwt_token", token);
              const response = yield fetch2(parsedUrl.toString(), {
                method: method.toUpperCase(),
                headers: {
                  accept: (_b = options2.accept) !== null && _b !== void 0 ? _b : CONTENT_TYPE_EVENT_STREAM,
                  "content-type": "application/json"
                },
                body: input && method !== "get" ? JSON.stringify(input) : void 0,
                signal: this.abortController.signal
              });
              this._requestId = response.headers.get("x-fal-request-id");
              return yield this.handleResponse(response);
            }
            return yield (0, request_1.dispatchRequest)({
              method: method.toUpperCase(),
              targetUrl: this.url,
              input,
              config: this.config,
              options: {
                headers: {
                  accept: (_c = options2.accept) !== null && _c !== void 0 ? _c : CONTENT_TYPE_EVENT_STREAM
                },
                responseHandler: /* @__PURE__ */ __name((response) => __awaiter(this, void 0, void 0, function* () {
                  this._requestId = response.headers.get("x-fal-request-id");
                  return yield this.handleResponse(response);
                }), "responseHandler"),
                signal: this.abortController.signal
              }
            });
          } catch (error) {
            this.handleError(error);
          }
        });
        this.handleResponse = (response) => __awaiter(this, void 0, void 0, function* () {
          var _a2, _b;
          if (!response.ok) {
            try {
              yield (0, response_1.defaultResponseHandler)(response);
            } catch (error) {
              this.emit("error", error);
            }
            return;
          }
          const body = response.body;
          if (!body) {
            this.emit("error", new response_1.ApiError({
              message: "Response body is empty.",
              status: 400,
              body: void 0,
              requestId: this._requestId || void 0
            }));
            return;
          }
          const isEventStream = ((_a2 = response.headers.get("content-type")) !== null && _a2 !== void 0 ? _a2 : "").startsWith(CONTENT_TYPE_EVENT_STREAM);
          if (!isEventStream) {
            const reader2 = body.getReader();
            const emitRawChunk = /* @__PURE__ */ __name(() => {
              reader2.read().then(({ done, value }) => {
                if (done) {
                  this.emit("done", this.currentData);
                  return;
                }
                this.buffer.push(value);
                this.currentData = value;
                this.emit("data", value);
                emitRawChunk();
              });
            }, "emitRawChunk");
            emitRawChunk();
            return;
          }
          const decoder = new TextDecoder("utf-8");
          const reader = response.body.getReader();
          const parser = (0, eventsource_parser_1.createParser)((event) => {
            if (event.type === "event") {
              const data = event.data;
              try {
                const parsedData = JSON.parse(data);
                this.buffer.push(parsedData);
                this.currentData = parsedData;
                this.emit("data", parsedData);
                this.emit("message", parsedData);
              } catch (e) {
                this.emit("error", e);
              }
            }
          });
          const timeout = (_b = this.options.timeout) !== null && _b !== void 0 ? _b : EVENT_STREAM_TIMEOUT;
          const readPartialResponse = /* @__PURE__ */ __name(() => __awaiter(this, void 0, void 0, function* () {
            const { value, done } = yield reader.read();
            this.lastEventTimestamp = Date.now();
            parser.feed(decoder.decode(value));
            if (Date.now() - this.lastEventTimestamp > timeout) {
              this.emit("error", new response_1.ApiError({
                message: `Event stream timed out after ${(timeout / 1e3).toFixed(0)} seconds with no messages.`,
                status: 408,
                requestId: this._requestId || void 0
              }));
            }
            if (!done) {
              readPartialResponse().catch(this.handleError);
            } else {
              this.emit("done", this.currentData);
            }
          }), "readPartialResponse");
          readPartialResponse().catch(this.handleError);
          return;
        });
        this.handleError = (error) => {
          var _a2;
          if (error.name === "AbortError" || this.signal.aborted) {
            return;
          }
          const apiError = error instanceof response_1.ApiError ? error : new response_1.ApiError({
            message: (_a2 = error.message) !== null && _a2 !== void 0 ? _a2 : "An unknown error occurred",
            status: 500,
            requestId: this._requestId || void 0
          });
          this.emit("error", apiError);
          return;
        };
        this.on = (type, listener) => {
          var _a2;
          if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
          }
          (_a2 = this.listeners.get(type)) === null || _a2 === void 0 ? void 0 : _a2.push(listener);
        };
        this.emit = (type, event) => {
          const listeners = this.listeners.get(type) || [];
          for (const listener of listeners) {
            listener(event);
          }
        };
        this.done = () => __awaiter(this, void 0, void 0, function* () {
          return this.donePromise;
        });
        this.abort = (reason) => {
          if (!this.streamClosed) {
            this.abortController.abort(reason);
          }
        };
        this.endpointId = endpointId;
        this.config = config;
        this.url = (_a = options.url) !== null && _a !== void 0 ? _a : (0, request_1.buildUrl)(endpointId, {
          path: (0, utils_1.resolveEndpointPath)(endpointId, void 0, "/stream"),
          query: options.queryParams
        });
        this.options = options;
        this.donePromise = new Promise((resolve, reject) => {
          if (this.streamClosed) {
            reject(new response_1.ApiError({
              message: "Streaming connection is already closed.",
              status: 400,
              body: void 0,
              requestId: this._requestId || void 0
            }));
          }
          this.signal.addEventListener("abort", () => {
            var _a2;
            resolve((_a2 = this.currentData) !== null && _a2 !== void 0 ? _a2 : {});
          });
          this.on("done", (data) => {
            this.streamClosed = true;
            resolve(data);
          });
          this.on("error", (error) => {
            this.streamClosed = true;
            reject(error);
          });
        });
        if (options.signal) {
          options.signal.addEventListener("abort", () => {
            this.abortController.abort();
          });
        }
        this.start().catch(this.handleError);
      }
      [Symbol.asyncIterator]() {
        return __asyncGenerator(this, arguments, /* @__PURE__ */ __name(function* _a() {
          let running = true;
          const stopAsyncIterator = /* @__PURE__ */ __name(() => running = false, "stopAsyncIterator");
          this.on("error", stopAsyncIterator);
          this.on("done", stopAsyncIterator);
          while (running || this.buffer.length > 0) {
            const data = this.buffer.shift();
            if (data) {
              yield yield __await(data);
            }
            yield __await(new Promise((resolve) => setTimeout(resolve, 16)));
          }
        }, "_a"));
      }
      /**
       * Gets the `AbortSignal` instance that can be used to listen for abort events.
       *
       * **Note:** this signal is internal to the `FalStream` instance. If you pass your
       * own abort signal, the `FalStream` will listen to it and abort it appropriately.
       *
       * @returns the `AbortSignal` instance.
       * @see https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
       */
      get signal() {
        return this.abortController.signal;
      }
      /**
       * Gets the request id of the streaming request.
       *
       * @returns the request id.
       */
      get requestId() {
        return this._requestId;
      }
    };
    exports.FalStream = FalStream;
    function createStreamingClient({ config, storage }) {
      return {
        stream(endpointId, options) {
          return __awaiter(this, void 0, void 0, function* () {
            const input = options.input ? yield storage.transformInput(options.input) : void 0;
            return new FalStream(endpointId, config, Object.assign(Object.assign({}, options), { input }));
          });
        }
      };
    }
    __name(createStreamingClient, "createStreamingClient");
  }
});

// node_modules/@fal-ai/client/src/queue.js
var require_queue = __commonJS({
  "node_modules/@fal-ai/client/src/queue.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    var __awaiter = exports && exports.__awaiter || function(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function(resolve) {
          resolve(value);
        });
      }
      __name(adopt, "adopt");
      return new (P || (P = Promise))(function(resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }
        __name(fulfilled, "fulfilled");
        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }
        __name(rejected, "rejected");
        function step(result2) {
          result2.done ? resolve(result2.value) : adopt(result2.value).then(fulfilled, rejected);
        }
        __name(step, "step");
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
    var __rest = exports && exports.__rest || function(s, e) {
      var t = {};
      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
      if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
          if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
            t[p[i]] = s[p[i]];
        }
      return t;
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createQueueClient = void 0;
    var headers_1 = require_headers();
    var request_1 = require_request();
    var response_1 = require_response();
    var retry_1 = require_retry();
    var storage_1 = require_storage();
    var streaming_1 = require_streaming();
    var utils_1 = require_utils();
    var DEFAULT_POLL_INTERVAL = 500;
    var QUEUE_RETRY_CONFIG = {
      maxRetries: 3,
      baseDelay: 1e3,
      maxDelay: 6e4,
      retryableStatusCodes: retry_1.DEFAULT_RETRYABLE_STATUS_CODES
    };
    var QUEUE_STATUS_RETRY_CONFIG = {
      maxRetries: 5,
      baseDelay: 1e3,
      maxDelay: 3e4,
      retryableStatusCodes: [...retry_1.DEFAULT_RETRYABLE_STATUS_CODES, 500]
    };
    var createQueueClient = /* @__PURE__ */ __name(({ config, storage }) => {
      const ref = {
        submit(endpointId, options) {
          return __awaiter(this, void 0, void 0, function* () {
            const { webhookUrl, priority, hint, startTimeout, headers: headers7, storageSettings } = options, runOptions = __rest(options, ["webhookUrl", "priority", "hint", "startTimeout", "headers", "storageSettings"]);
            const input = options.input ? yield storage.transformInput(options.input) : void 0;
            const extraHeaders = Object.fromEntries(Object.entries(headers7 !== null && headers7 !== void 0 ? headers7 : {}).map(([key, value]) => [
              key.toLowerCase(),
              value
            ]));
            return (0, request_1.dispatchRequest)({
              method: options.method,
              targetUrl: (0, request_1.buildUrl)(endpointId, Object.assign(Object.assign({}, runOptions), { subdomain: "queue", query: webhookUrl ? { fal_webhook: webhookUrl } : void 0 })),
              headers: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, extraHeaders), (0, storage_1.buildObjectLifecycleHeaders)(storageSettings)), { [headers_1.QUEUE_PRIORITY_HEADER]: priority !== null && priority !== void 0 ? priority : "normal" }), hint && { [headers_1.RUNNER_HINT_HEADER]: hint }), (0, headers_1.buildTimeoutHeaders)(startTimeout)),
              input,
              config,
              options: {
                signal: options.abortSignal,
                retry: QUEUE_RETRY_CONFIG
              }
            });
          });
        },
        status(endpointId_1, _a) {
          return __awaiter(this, arguments, void 0, function* (endpointId, { requestId, logs = false, abortSignal }) {
            const appId = (0, utils_1.parseEndpointId)(endpointId);
            const prefix = appId.namespace ? `${appId.namespace}/` : "";
            return (0, request_1.dispatchRequest)({
              method: "get",
              targetUrl: (0, request_1.buildUrl)(`${prefix}${appId.owner}/${appId.alias}`, {
                subdomain: "queue",
                query: { logs: logs ? "1" : "0" },
                path: `/requests/${requestId}/status`
              }),
              config,
              options: {
                signal: abortSignal,
                retry: QUEUE_STATUS_RETRY_CONFIG
              }
            });
          });
        },
        streamStatus(endpointId_1, _a) {
          return __awaiter(this, arguments, void 0, function* (endpointId, { requestId, logs = false, connectionMode }) {
            const appId = (0, utils_1.parseEndpointId)(endpointId);
            const prefix = appId.namespace ? `${appId.namespace}/` : "";
            const queryParams2 = {
              logs: logs ? "1" : "0"
            };
            const url = (0, request_1.buildUrl)(`${prefix}${appId.owner}/${appId.alias}`, {
              subdomain: "queue",
              path: `/requests/${requestId}/status/stream`,
              query: queryParams2
            });
            return new streaming_1.FalStream(endpointId, config, {
              url,
              method: "get",
              connectionMode,
              queryParams: queryParams2
            });
          });
        },
        subscribeToStatus(endpointId, options) {
          return __awaiter(this, void 0, void 0, function* () {
            const requestId = options.requestId;
            const timeout = options.timeout;
            let timeoutId = void 0;
            const handleCancelError = /* @__PURE__ */ __name(() => {
            }, "handleCancelError");
            if (options.mode === "streaming") {
              const status = yield ref.streamStatus(endpointId, {
                requestId,
                logs: options.logs,
                connectionMode: "connectionMode" in options ? options.connectionMode : void 0
              });
              const logs = [];
              if (timeout) {
                timeoutId = setTimeout(() => {
                  status.abort();
                  ref.cancel(endpointId, { requestId }).catch(handleCancelError);
                  throw new Error(`Client timed out waiting for the request to complete after ${timeout}ms`);
                }, timeout);
              }
              status.on("data", (data) => {
                if (options.onQueueUpdate) {
                  if ("logs" in data && Array.isArray(data.logs) && data.logs.length > 0) {
                    logs.push(...data.logs);
                  }
                  options.onQueueUpdate("logs" in data ? Object.assign(Object.assign({}, data), { logs }) : data);
                }
              });
              const doneStatus = yield status.done();
              if (timeoutId) {
                clearTimeout(timeoutId);
              }
              return doneStatus;
            }
            return new Promise((resolve, reject) => {
              var _a;
              let pollingTimeoutId;
              const pollInterval = "pollInterval" in options && typeof options.pollInterval === "number" ? (_a = options.pollInterval) !== null && _a !== void 0 ? _a : DEFAULT_POLL_INTERVAL : DEFAULT_POLL_INTERVAL;
              const clearScheduledTasks = /* @__PURE__ */ __name(() => {
                if (timeoutId) {
                  clearTimeout(timeoutId);
                }
                if (pollingTimeoutId) {
                  clearTimeout(pollingTimeoutId);
                }
              }, "clearScheduledTasks");
              if (timeout) {
                timeoutId = setTimeout(() => {
                  clearScheduledTasks();
                  ref.cancel(endpointId, { requestId }).catch(handleCancelError);
                  reject(new Error(`Client timed out waiting for the request to complete after ${timeout}ms`));
                }, timeout);
              }
              const poll = /* @__PURE__ */ __name(() => __awaiter(this, void 0, void 0, function* () {
                var _a2;
                try {
                  const requestStatus = yield ref.status(endpointId, {
                    requestId,
                    logs: (_a2 = options.logs) !== null && _a2 !== void 0 ? _a2 : false,
                    abortSignal: options.abortSignal
                  });
                  if (options.onQueueUpdate) {
                    options.onQueueUpdate(requestStatus);
                  }
                  if (requestStatus.status === "COMPLETED") {
                    clearScheduledTasks();
                    resolve(requestStatus);
                    return;
                  }
                  pollingTimeoutId = setTimeout(poll, pollInterval);
                } catch (error) {
                  clearScheduledTasks();
                  reject(error);
                }
              }), "poll");
              poll().catch(reject);
            });
          });
        },
        result(endpointId_1, _a) {
          return __awaiter(this, arguments, void 0, function* (endpointId, { requestId, abortSignal }) {
            const appId = (0, utils_1.parseEndpointId)(endpointId);
            const prefix = appId.namespace ? `${appId.namespace}/` : "";
            return (0, request_1.dispatchRequest)({
              method: "get",
              targetUrl: (0, request_1.buildUrl)(`${prefix}${appId.owner}/${appId.alias}`, {
                subdomain: "queue",
                path: `/requests/${requestId}`
              }),
              config: Object.assign(Object.assign({}, config), { responseHandler: response_1.resultResponseHandler }),
              options: {
                signal: abortSignal,
                retry: QUEUE_RETRY_CONFIG
              }
            });
          });
        },
        cancel(endpointId_1, _a) {
          return __awaiter(this, arguments, void 0, function* (endpointId, { requestId, abortSignal }) {
            const appId = (0, utils_1.parseEndpointId)(endpointId);
            const prefix = appId.namespace ? `${appId.namespace}/` : "";
            yield (0, request_1.dispatchRequest)({
              method: "put",
              targetUrl: (0, request_1.buildUrl)(`${prefix}${appId.owner}/${appId.alias}`, {
                subdomain: "queue",
                path: `/requests/${requestId}/cancel`
              }),
              config,
              options: {
                signal: abortSignal
              }
            });
          });
        }
      };
      return ref;
    }, "createQueueClient");
    exports.createQueueClient = createQueueClient;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/utils/utf8.cjs
var require_utf8 = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/utils/utf8.cjs"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.utf8Count = utf8Count;
    exports.utf8EncodeJs = utf8EncodeJs;
    exports.utf8EncodeTE = utf8EncodeTE;
    exports.utf8Encode = utf8Encode;
    exports.utf8DecodeJs = utf8DecodeJs;
    exports.utf8DecodeTD = utf8DecodeTD;
    exports.utf8Decode = utf8Decode;
    function utf8Count(str) {
      const strLength = str.length;
      let byteLength = 0;
      let pos = 0;
      while (pos < strLength) {
        let value = str.charCodeAt(pos++);
        if ((value & 4294967168) === 0) {
          byteLength++;
          continue;
        } else if ((value & 4294965248) === 0) {
          byteLength += 2;
        } else {
          if (value >= 55296 && value <= 56319) {
            if (pos < strLength) {
              const extra = str.charCodeAt(pos);
              if ((extra & 64512) === 56320) {
                ++pos;
                value = ((value & 1023) << 10) + (extra & 1023) + 65536;
              }
            }
          }
          if ((value & 4294901760) === 0) {
            byteLength += 3;
          } else {
            byteLength += 4;
          }
        }
      }
      return byteLength;
    }
    __name(utf8Count, "utf8Count");
    function utf8EncodeJs(str, output, outputOffset) {
      const strLength = str.length;
      let offset = outputOffset;
      let pos = 0;
      while (pos < strLength) {
        let value = str.charCodeAt(pos++);
        if ((value & 4294967168) === 0) {
          output[offset++] = value;
          continue;
        } else if ((value & 4294965248) === 0) {
          output[offset++] = value >> 6 & 31 | 192;
        } else {
          if (value >= 55296 && value <= 56319) {
            if (pos < strLength) {
              const extra = str.charCodeAt(pos);
              if ((extra & 64512) === 56320) {
                ++pos;
                value = ((value & 1023) << 10) + (extra & 1023) + 65536;
              }
            }
          }
          if ((value & 4294901760) === 0) {
            output[offset++] = value >> 12 & 15 | 224;
            output[offset++] = value >> 6 & 63 | 128;
          } else {
            output[offset++] = value >> 18 & 7 | 240;
            output[offset++] = value >> 12 & 63 | 128;
            output[offset++] = value >> 6 & 63 | 128;
          }
        }
        output[offset++] = value & 63 | 128;
      }
    }
    __name(utf8EncodeJs, "utf8EncodeJs");
    var sharedTextEncoder = new TextEncoder();
    var TEXT_ENCODER_THRESHOLD = 50;
    function utf8EncodeTE(str, output, outputOffset) {
      sharedTextEncoder.encodeInto(str, output.subarray(outputOffset));
    }
    __name(utf8EncodeTE, "utf8EncodeTE");
    function utf8Encode(str, output, outputOffset) {
      if (str.length > TEXT_ENCODER_THRESHOLD) {
        utf8EncodeTE(str, output, outputOffset);
      } else {
        utf8EncodeJs(str, output, outputOffset);
      }
    }
    __name(utf8Encode, "utf8Encode");
    var CHUNK_SIZE = 4096;
    function utf8DecodeJs(bytes, inputOffset, byteLength) {
      let offset = inputOffset;
      const end = offset + byteLength;
      const units = [];
      let result2 = "";
      while (offset < end) {
        const byte1 = bytes[offset++];
        if ((byte1 & 128) === 0) {
          units.push(byte1);
        } else if ((byte1 & 224) === 192) {
          const byte2 = bytes[offset++] & 63;
          units.push((byte1 & 31) << 6 | byte2);
        } else if ((byte1 & 240) === 224) {
          const byte2 = bytes[offset++] & 63;
          const byte3 = bytes[offset++] & 63;
          units.push((byte1 & 31) << 12 | byte2 << 6 | byte3);
        } else if ((byte1 & 248) === 240) {
          const byte2 = bytes[offset++] & 63;
          const byte3 = bytes[offset++] & 63;
          const byte4 = bytes[offset++] & 63;
          let unit = (byte1 & 7) << 18 | byte2 << 12 | byte3 << 6 | byte4;
          if (unit > 65535) {
            unit -= 65536;
            units.push(unit >>> 10 & 1023 | 55296);
            unit = 56320 | unit & 1023;
          }
          units.push(unit);
        } else {
          units.push(byte1);
        }
        if (units.length >= CHUNK_SIZE) {
          result2 += String.fromCharCode(...units);
          units.length = 0;
        }
      }
      if (units.length > 0) {
        result2 += String.fromCharCode(...units);
      }
      return result2;
    }
    __name(utf8DecodeJs, "utf8DecodeJs");
    var sharedTextDecoder = new TextDecoder();
    var TEXT_DECODER_THRESHOLD = 200;
    function utf8DecodeTD(bytes, inputOffset, byteLength) {
      const stringBytes = bytes.subarray(inputOffset, inputOffset + byteLength);
      return sharedTextDecoder.decode(stringBytes);
    }
    __name(utf8DecodeTD, "utf8DecodeTD");
    function utf8Decode(bytes, inputOffset, byteLength) {
      if (byteLength > TEXT_DECODER_THRESHOLD) {
        return utf8DecodeTD(bytes, inputOffset, byteLength);
      } else {
        return utf8DecodeJs(bytes, inputOffset, byteLength);
      }
    }
    __name(utf8Decode, "utf8Decode");
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/ExtData.cjs
var require_ExtData = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/ExtData.cjs"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ExtData = void 0;
    var ExtData = class {
      static {
        __name(this, "ExtData");
      }
      type;
      data;
      constructor(type, data) {
        this.type = type;
        this.data = data;
      }
    };
    exports.ExtData = ExtData;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/DecodeError.cjs
var require_DecodeError = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/DecodeError.cjs"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DecodeError = void 0;
    var DecodeError = class _DecodeError extends Error {
      static {
        __name(this, "DecodeError");
      }
      constructor(message) {
        super(message);
        const proto = Object.create(_DecodeError.prototype);
        Object.setPrototypeOf(this, proto);
        Object.defineProperty(this, "name", {
          configurable: true,
          enumerable: false,
          value: _DecodeError.name
        });
      }
    };
    exports.DecodeError = DecodeError;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/utils/int.cjs
var require_int = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/utils/int.cjs"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.UINT32_MAX = void 0;
    exports.setUint64 = setUint64;
    exports.setInt64 = setInt64;
    exports.getInt64 = getInt64;
    exports.getUint64 = getUint64;
    exports.UINT32_MAX = 4294967295;
    function setUint64(view, offset, value) {
      const high = value / 4294967296;
      const low = value;
      view.setUint32(offset, high);
      view.setUint32(offset + 4, low);
    }
    __name(setUint64, "setUint64");
    function setInt64(view, offset, value) {
      const high = Math.floor(value / 4294967296);
      const low = value;
      view.setUint32(offset, high);
      view.setUint32(offset + 4, low);
    }
    __name(setInt64, "setInt64");
    function getInt64(view, offset) {
      const high = view.getInt32(offset);
      const low = view.getUint32(offset + 4);
      return high * 4294967296 + low;
    }
    __name(getInt64, "getInt64");
    function getUint64(view, offset) {
      const high = view.getUint32(offset);
      const low = view.getUint32(offset + 4);
      return high * 4294967296 + low;
    }
    __name(getUint64, "getUint64");
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/timestamp.cjs
var require_timestamp = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/timestamp.cjs"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.timestampExtension = exports.EXT_TIMESTAMP = void 0;
    exports.encodeTimeSpecToTimestamp = encodeTimeSpecToTimestamp;
    exports.encodeDateToTimeSpec = encodeDateToTimeSpec;
    exports.encodeTimestampExtension = encodeTimestampExtension;
    exports.decodeTimestampToTimeSpec = decodeTimestampToTimeSpec;
    exports.decodeTimestampExtension = decodeTimestampExtension;
    var DecodeError_ts_1 = require_DecodeError();
    var int_ts_1 = require_int();
    exports.EXT_TIMESTAMP = -1;
    var TIMESTAMP32_MAX_SEC = 4294967296 - 1;
    var TIMESTAMP64_MAX_SEC = 17179869184 - 1;
    function encodeTimeSpecToTimestamp({ sec, nsec }) {
      if (sec >= 0 && nsec >= 0 && sec <= TIMESTAMP64_MAX_SEC) {
        if (nsec === 0 && sec <= TIMESTAMP32_MAX_SEC) {
          const rv = new Uint8Array(4);
          const view = new DataView(rv.buffer);
          view.setUint32(0, sec);
          return rv;
        } else {
          const secHigh = sec / 4294967296;
          const secLow = sec & 4294967295;
          const rv = new Uint8Array(8);
          const view = new DataView(rv.buffer);
          view.setUint32(0, nsec << 2 | secHigh & 3);
          view.setUint32(4, secLow);
          return rv;
        }
      } else {
        const rv = new Uint8Array(12);
        const view = new DataView(rv.buffer);
        view.setUint32(0, nsec);
        (0, int_ts_1.setInt64)(view, 4, sec);
        return rv;
      }
    }
    __name(encodeTimeSpecToTimestamp, "encodeTimeSpecToTimestamp");
    function encodeDateToTimeSpec(date) {
      const msec = date.getTime();
      const sec = Math.floor(msec / 1e3);
      const nsec = (msec - sec * 1e3) * 1e6;
      const nsecInSec = Math.floor(nsec / 1e9);
      return {
        sec: sec + nsecInSec,
        nsec: nsec - nsecInSec * 1e9
      };
    }
    __name(encodeDateToTimeSpec, "encodeDateToTimeSpec");
    function encodeTimestampExtension(object) {
      if (object instanceof Date) {
        const timeSpec = encodeDateToTimeSpec(object);
        return encodeTimeSpecToTimestamp(timeSpec);
      } else {
        return null;
      }
    }
    __name(encodeTimestampExtension, "encodeTimestampExtension");
    function decodeTimestampToTimeSpec(data) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      switch (data.byteLength) {
        case 4: {
          const sec = view.getUint32(0);
          const nsec = 0;
          return { sec, nsec };
        }
        case 8: {
          const nsec30AndSecHigh2 = view.getUint32(0);
          const secLow32 = view.getUint32(4);
          const sec = (nsec30AndSecHigh2 & 3) * 4294967296 + secLow32;
          const nsec = nsec30AndSecHigh2 >>> 2;
          return { sec, nsec };
        }
        case 12: {
          const sec = (0, int_ts_1.getInt64)(view, 4);
          const nsec = view.getUint32(0);
          return { sec, nsec };
        }
        default:
          throw new DecodeError_ts_1.DecodeError(`Unrecognized data size for timestamp (expected 4, 8, or 12): ${data.length}`);
      }
    }
    __name(decodeTimestampToTimeSpec, "decodeTimestampToTimeSpec");
    function decodeTimestampExtension(data) {
      const timeSpec = decodeTimestampToTimeSpec(data);
      return new Date(timeSpec.sec * 1e3 + timeSpec.nsec / 1e6);
    }
    __name(decodeTimestampExtension, "decodeTimestampExtension");
    exports.timestampExtension = {
      type: exports.EXT_TIMESTAMP,
      encode: encodeTimestampExtension,
      decode: decodeTimestampExtension
    };
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/ExtensionCodec.cjs
var require_ExtensionCodec = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/ExtensionCodec.cjs"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ExtensionCodec = void 0;
    var ExtData_ts_1 = require_ExtData();
    var timestamp_ts_1 = require_timestamp();
    var ExtensionCodec = class _ExtensionCodec {
      static {
        __name(this, "ExtensionCodec");
      }
      static defaultCodec = new _ExtensionCodec();
      // ensures ExtensionCodecType<X> matches ExtensionCodec<X>
      // this will make type errors a lot more clear
      // eslint-disable-next-line @typescript-eslint/naming-convention
      __brand;
      // built-in extensions
      builtInEncoders = [];
      builtInDecoders = [];
      // custom extensions
      encoders = [];
      decoders = [];
      constructor() {
        this.register(timestamp_ts_1.timestampExtension);
      }
      register({ type, encode, decode }) {
        if (type >= 0) {
          this.encoders[type] = encode;
          this.decoders[type] = decode;
        } else {
          const index = -1 - type;
          this.builtInEncoders[index] = encode;
          this.builtInDecoders[index] = decode;
        }
      }
      tryToEncode(object, context) {
        for (let i = 0; i < this.builtInEncoders.length; i++) {
          const encodeExt = this.builtInEncoders[i];
          if (encodeExt != null) {
            const data = encodeExt(object, context);
            if (data != null) {
              const type = -1 - i;
              return new ExtData_ts_1.ExtData(type, data);
            }
          }
        }
        for (let i = 0; i < this.encoders.length; i++) {
          const encodeExt = this.encoders[i];
          if (encodeExt != null) {
            const data = encodeExt(object, context);
            if (data != null) {
              const type = i;
              return new ExtData_ts_1.ExtData(type, data);
            }
          }
        }
        if (object instanceof ExtData_ts_1.ExtData) {
          return object;
        }
        return null;
      }
      decode(data, type, context) {
        const decodeExt = type < 0 ? this.builtInDecoders[-1 - type] : this.decoders[type];
        if (decodeExt) {
          return decodeExt(data, type, context);
        } else {
          return new ExtData_ts_1.ExtData(type, data);
        }
      }
    };
    exports.ExtensionCodec = ExtensionCodec;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/utils/typedArrays.cjs
var require_typedArrays = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/utils/typedArrays.cjs"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ensureUint8Array = ensureUint8Array;
    function isArrayBufferLike(buffer) {
      return buffer instanceof ArrayBuffer || typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer;
    }
    __name(isArrayBufferLike, "isArrayBufferLike");
    function ensureUint8Array(buffer) {
      if (buffer instanceof Uint8Array) {
        return buffer;
      } else if (ArrayBuffer.isView(buffer)) {
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      } else if (isArrayBufferLike(buffer)) {
        return new Uint8Array(buffer);
      } else {
        return Uint8Array.from(buffer);
      }
    }
    __name(ensureUint8Array, "ensureUint8Array");
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/Encoder.cjs
var require_Encoder = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/Encoder.cjs"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Encoder = exports.DEFAULT_INITIAL_BUFFER_SIZE = exports.DEFAULT_MAX_DEPTH = void 0;
    var utf8_ts_1 = require_utf8();
    var ExtensionCodec_ts_1 = require_ExtensionCodec();
    var int_ts_1 = require_int();
    var typedArrays_ts_1 = require_typedArrays();
    exports.DEFAULT_MAX_DEPTH = 100;
    exports.DEFAULT_INITIAL_BUFFER_SIZE = 2048;
    var Encoder = class _Encoder {
      static {
        __name(this, "Encoder");
      }
      extensionCodec;
      context;
      useBigInt64;
      maxDepth;
      initialBufferSize;
      sortKeys;
      forceFloat32;
      ignoreUndefined;
      forceIntegerToFloat;
      pos;
      view;
      bytes;
      entered = false;
      constructor(options) {
        this.extensionCodec = options?.extensionCodec ?? ExtensionCodec_ts_1.ExtensionCodec.defaultCodec;
        this.context = options?.context;
        this.useBigInt64 = options?.useBigInt64 ?? false;
        this.maxDepth = options?.maxDepth ?? exports.DEFAULT_MAX_DEPTH;
        this.initialBufferSize = options?.initialBufferSize ?? exports.DEFAULT_INITIAL_BUFFER_SIZE;
        this.sortKeys = options?.sortKeys ?? false;
        this.forceFloat32 = options?.forceFloat32 ?? false;
        this.ignoreUndefined = options?.ignoreUndefined ?? false;
        this.forceIntegerToFloat = options?.forceIntegerToFloat ?? false;
        this.pos = 0;
        this.view = new DataView(new ArrayBuffer(this.initialBufferSize));
        this.bytes = new Uint8Array(this.view.buffer);
      }
      clone() {
        return new _Encoder({
          extensionCodec: this.extensionCodec,
          context: this.context,
          useBigInt64: this.useBigInt64,
          maxDepth: this.maxDepth,
          initialBufferSize: this.initialBufferSize,
          sortKeys: this.sortKeys,
          forceFloat32: this.forceFloat32,
          ignoreUndefined: this.ignoreUndefined,
          forceIntegerToFloat: this.forceIntegerToFloat
        });
      }
      reinitializeState() {
        this.pos = 0;
      }
      /**
       * This is almost equivalent to {@link Encoder#encode}, but it returns an reference of the encoder's internal buffer and thus much faster than {@link Encoder#encode}.
       *
       * @returns Encodes the object and returns a shared reference the encoder's internal buffer.
       */
      encodeSharedRef(object) {
        if (this.entered) {
          const instance = this.clone();
          return instance.encodeSharedRef(object);
        }
        try {
          this.entered = true;
          this.reinitializeState();
          this.doEncode(object, 1);
          return this.bytes.subarray(0, this.pos);
        } finally {
          this.entered = false;
        }
      }
      /**
       * @returns Encodes the object and returns a copy of the encoder's internal buffer.
       */
      encode(object) {
        if (this.entered) {
          const instance = this.clone();
          return instance.encode(object);
        }
        try {
          this.entered = true;
          this.reinitializeState();
          this.doEncode(object, 1);
          return this.bytes.slice(0, this.pos);
        } finally {
          this.entered = false;
        }
      }
      doEncode(object, depth) {
        if (depth > this.maxDepth) {
          throw new Error(`Too deep objects in depth ${depth}`);
        }
        if (object == null) {
          this.encodeNil();
        } else if (typeof object === "boolean") {
          this.encodeBoolean(object);
        } else if (typeof object === "number") {
          if (!this.forceIntegerToFloat) {
            this.encodeNumber(object);
          } else {
            this.encodeNumberAsFloat(object);
          }
        } else if (typeof object === "string") {
          this.encodeString(object);
        } else if (this.useBigInt64 && typeof object === "bigint") {
          this.encodeBigInt64(object);
        } else {
          this.encodeObject(object, depth);
        }
      }
      ensureBufferSizeToWrite(sizeToWrite) {
        const requiredSize = this.pos + sizeToWrite;
        if (this.view.byteLength < requiredSize) {
          this.resizeBuffer(requiredSize * 2);
        }
      }
      resizeBuffer(newSize) {
        const newBuffer = new ArrayBuffer(newSize);
        const newBytes = new Uint8Array(newBuffer);
        const newView = new DataView(newBuffer);
        newBytes.set(this.bytes);
        this.view = newView;
        this.bytes = newBytes;
      }
      encodeNil() {
        this.writeU8(192);
      }
      encodeBoolean(object) {
        if (object === false) {
          this.writeU8(194);
        } else {
          this.writeU8(195);
        }
      }
      encodeNumber(object) {
        if (!this.forceIntegerToFloat && Number.isSafeInteger(object)) {
          if (object >= 0) {
            if (object < 128) {
              this.writeU8(object);
            } else if (object < 256) {
              this.writeU8(204);
              this.writeU8(object);
            } else if (object < 65536) {
              this.writeU8(205);
              this.writeU16(object);
            } else if (object < 4294967296) {
              this.writeU8(206);
              this.writeU32(object);
            } else if (!this.useBigInt64) {
              this.writeU8(207);
              this.writeU64(object);
            } else {
              this.encodeNumberAsFloat(object);
            }
          } else {
            if (object >= -32) {
              this.writeU8(224 | object + 32);
            } else if (object >= -128) {
              this.writeU8(208);
              this.writeI8(object);
            } else if (object >= -32768) {
              this.writeU8(209);
              this.writeI16(object);
            } else if (object >= -2147483648) {
              this.writeU8(210);
              this.writeI32(object);
            } else if (!this.useBigInt64) {
              this.writeU8(211);
              this.writeI64(object);
            } else {
              this.encodeNumberAsFloat(object);
            }
          }
        } else {
          this.encodeNumberAsFloat(object);
        }
      }
      encodeNumberAsFloat(object) {
        if (this.forceFloat32) {
          this.writeU8(202);
          this.writeF32(object);
        } else {
          this.writeU8(203);
          this.writeF64(object);
        }
      }
      encodeBigInt64(object) {
        if (object >= BigInt(0)) {
          this.writeU8(207);
          this.writeBigUint64(object);
        } else {
          this.writeU8(211);
          this.writeBigInt64(object);
        }
      }
      writeStringHeader(byteLength) {
        if (byteLength < 32) {
          this.writeU8(160 + byteLength);
        } else if (byteLength < 256) {
          this.writeU8(217);
          this.writeU8(byteLength);
        } else if (byteLength < 65536) {
          this.writeU8(218);
          this.writeU16(byteLength);
        } else if (byteLength < 4294967296) {
          this.writeU8(219);
          this.writeU32(byteLength);
        } else {
          throw new Error(`Too long string: ${byteLength} bytes in UTF-8`);
        }
      }
      encodeString(object) {
        const maxHeaderSize = 1 + 4;
        const byteLength = (0, utf8_ts_1.utf8Count)(object);
        this.ensureBufferSizeToWrite(maxHeaderSize + byteLength);
        this.writeStringHeader(byteLength);
        (0, utf8_ts_1.utf8Encode)(object, this.bytes, this.pos);
        this.pos += byteLength;
      }
      encodeObject(object, depth) {
        const ext = this.extensionCodec.tryToEncode(object, this.context);
        if (ext != null) {
          this.encodeExtension(ext);
        } else if (Array.isArray(object)) {
          this.encodeArray(object, depth);
        } else if (ArrayBuffer.isView(object)) {
          this.encodeBinary(object);
        } else if (typeof object === "object") {
          this.encodeMap(object, depth);
        } else {
          throw new Error(`Unrecognized object: ${Object.prototype.toString.apply(object)}`);
        }
      }
      encodeBinary(object) {
        const size = object.byteLength;
        if (size < 256) {
          this.writeU8(196);
          this.writeU8(size);
        } else if (size < 65536) {
          this.writeU8(197);
          this.writeU16(size);
        } else if (size < 4294967296) {
          this.writeU8(198);
          this.writeU32(size);
        } else {
          throw new Error(`Too large binary: ${size}`);
        }
        const bytes = (0, typedArrays_ts_1.ensureUint8Array)(object);
        this.writeU8a(bytes);
      }
      encodeArray(object, depth) {
        const size = object.length;
        if (size < 16) {
          this.writeU8(144 + size);
        } else if (size < 65536) {
          this.writeU8(220);
          this.writeU16(size);
        } else if (size < 4294967296) {
          this.writeU8(221);
          this.writeU32(size);
        } else {
          throw new Error(`Too large array: ${size}`);
        }
        for (const item of object) {
          this.doEncode(item, depth + 1);
        }
      }
      countWithoutUndefined(object, keys) {
        let count = 0;
        for (const key of keys) {
          if (object[key] !== void 0) {
            count++;
          }
        }
        return count;
      }
      encodeMap(object, depth) {
        const keys = Object.keys(object);
        if (this.sortKeys) {
          keys.sort();
        }
        const size = this.ignoreUndefined ? this.countWithoutUndefined(object, keys) : keys.length;
        if (size < 16) {
          this.writeU8(128 + size);
        } else if (size < 65536) {
          this.writeU8(222);
          this.writeU16(size);
        } else if (size < 4294967296) {
          this.writeU8(223);
          this.writeU32(size);
        } else {
          throw new Error(`Too large map object: ${size}`);
        }
        for (const key of keys) {
          const value = object[key];
          if (!(this.ignoreUndefined && value === void 0)) {
            this.encodeString(key);
            this.doEncode(value, depth + 1);
          }
        }
      }
      encodeExtension(ext) {
        if (typeof ext.data === "function") {
          const data = ext.data(this.pos + 6);
          const size2 = data.length;
          if (size2 >= 4294967296) {
            throw new Error(`Too large extension object: ${size2}`);
          }
          this.writeU8(201);
          this.writeU32(size2);
          this.writeI8(ext.type);
          this.writeU8a(data);
          return;
        }
        const size = ext.data.length;
        if (size === 1) {
          this.writeU8(212);
        } else if (size === 2) {
          this.writeU8(213);
        } else if (size === 4) {
          this.writeU8(214);
        } else if (size === 8) {
          this.writeU8(215);
        } else if (size === 16) {
          this.writeU8(216);
        } else if (size < 256) {
          this.writeU8(199);
          this.writeU8(size);
        } else if (size < 65536) {
          this.writeU8(200);
          this.writeU16(size);
        } else if (size < 4294967296) {
          this.writeU8(201);
          this.writeU32(size);
        } else {
          throw new Error(`Too large extension object: ${size}`);
        }
        this.writeI8(ext.type);
        this.writeU8a(ext.data);
      }
      writeU8(value) {
        this.ensureBufferSizeToWrite(1);
        this.view.setUint8(this.pos, value);
        this.pos++;
      }
      writeU8a(values) {
        const size = values.length;
        this.ensureBufferSizeToWrite(size);
        this.bytes.set(values, this.pos);
        this.pos += size;
      }
      writeI8(value) {
        this.ensureBufferSizeToWrite(1);
        this.view.setInt8(this.pos, value);
        this.pos++;
      }
      writeU16(value) {
        this.ensureBufferSizeToWrite(2);
        this.view.setUint16(this.pos, value);
        this.pos += 2;
      }
      writeI16(value) {
        this.ensureBufferSizeToWrite(2);
        this.view.setInt16(this.pos, value);
        this.pos += 2;
      }
      writeU32(value) {
        this.ensureBufferSizeToWrite(4);
        this.view.setUint32(this.pos, value);
        this.pos += 4;
      }
      writeI32(value) {
        this.ensureBufferSizeToWrite(4);
        this.view.setInt32(this.pos, value);
        this.pos += 4;
      }
      writeF32(value) {
        this.ensureBufferSizeToWrite(4);
        this.view.setFloat32(this.pos, value);
        this.pos += 4;
      }
      writeF64(value) {
        this.ensureBufferSizeToWrite(8);
        this.view.setFloat64(this.pos, value);
        this.pos += 8;
      }
      writeU64(value) {
        this.ensureBufferSizeToWrite(8);
        (0, int_ts_1.setUint64)(this.view, this.pos, value);
        this.pos += 8;
      }
      writeI64(value) {
        this.ensureBufferSizeToWrite(8);
        (0, int_ts_1.setInt64)(this.view, this.pos, value);
        this.pos += 8;
      }
      writeBigUint64(value) {
        this.ensureBufferSizeToWrite(8);
        this.view.setBigUint64(this.pos, value);
        this.pos += 8;
      }
      writeBigInt64(value) {
        this.ensureBufferSizeToWrite(8);
        this.view.setBigInt64(this.pos, value);
        this.pos += 8;
      }
    };
    exports.Encoder = Encoder;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/encode.cjs
var require_encode = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/encode.cjs"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.encode = encode;
    var Encoder_ts_1 = require_Encoder();
    function encode(value, options) {
      const encoder = new Encoder_ts_1.Encoder(options);
      return encoder.encodeSharedRef(value);
    }
    __name(encode, "encode");
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/utils/prettyByte.cjs
var require_prettyByte = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/utils/prettyByte.cjs"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.prettyByte = prettyByte;
    function prettyByte(byte) {
      return `${byte < 0 ? "-" : ""}0x${Math.abs(byte).toString(16).padStart(2, "0")}`;
    }
    __name(prettyByte, "prettyByte");
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/CachedKeyDecoder.cjs
var require_CachedKeyDecoder = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/CachedKeyDecoder.cjs"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CachedKeyDecoder = void 0;
    var utf8_ts_1 = require_utf8();
    var DEFAULT_MAX_KEY_LENGTH = 16;
    var DEFAULT_MAX_LENGTH_PER_KEY = 16;
    var CachedKeyDecoder = class {
      static {
        __name(this, "CachedKeyDecoder");
      }
      hit = 0;
      miss = 0;
      caches;
      maxKeyLength;
      maxLengthPerKey;
      constructor(maxKeyLength = DEFAULT_MAX_KEY_LENGTH, maxLengthPerKey = DEFAULT_MAX_LENGTH_PER_KEY) {
        this.maxKeyLength = maxKeyLength;
        this.maxLengthPerKey = maxLengthPerKey;
        this.caches = [];
        for (let i = 0; i < this.maxKeyLength; i++) {
          this.caches.push([]);
        }
      }
      canBeCached(byteLength) {
        return byteLength > 0 && byteLength <= this.maxKeyLength;
      }
      find(bytes, inputOffset, byteLength) {
        const records = this.caches[byteLength - 1];
        FIND_CHUNK: for (const record2 of records) {
          const recordBytes = record2.bytes;
          for (let j = 0; j < byteLength; j++) {
            if (recordBytes[j] !== bytes[inputOffset + j]) {
              continue FIND_CHUNK;
            }
          }
          return record2.str;
        }
        return null;
      }
      store(bytes, value) {
        const records = this.caches[bytes.length - 1];
        const record2 = { bytes, str: value };
        if (records.length >= this.maxLengthPerKey) {
          records[Math.random() * records.length | 0] = record2;
        } else {
          records.push(record2);
        }
      }
      decode(bytes, inputOffset, byteLength) {
        const cachedValue = this.find(bytes, inputOffset, byteLength);
        if (cachedValue != null) {
          this.hit++;
          return cachedValue;
        }
        this.miss++;
        const str = (0, utf8_ts_1.utf8DecodeJs)(bytes, inputOffset, byteLength);
        const slicedCopyOfBytes = Uint8Array.prototype.slice.call(bytes, inputOffset, inputOffset + byteLength);
        this.store(slicedCopyOfBytes, str);
        return str;
      }
    };
    exports.CachedKeyDecoder = CachedKeyDecoder;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/Decoder.cjs
var require_Decoder = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/Decoder.cjs"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Decoder = void 0;
    var prettyByte_ts_1 = require_prettyByte();
    var ExtensionCodec_ts_1 = require_ExtensionCodec();
    var int_ts_1 = require_int();
    var utf8_ts_1 = require_utf8();
    var typedArrays_ts_1 = require_typedArrays();
    var CachedKeyDecoder_ts_1 = require_CachedKeyDecoder();
    var DecodeError_ts_1 = require_DecodeError();
    var STATE_ARRAY = "array";
    var STATE_MAP_KEY = "map_key";
    var STATE_MAP_VALUE = "map_value";
    var mapKeyConverter = /* @__PURE__ */ __name((key) => {
      if (typeof key === "string" || typeof key === "number") {
        return key;
      }
      throw new DecodeError_ts_1.DecodeError("The type of key must be string or number but " + typeof key);
    }, "mapKeyConverter");
    var StackPool = class {
      static {
        __name(this, "StackPool");
      }
      stack = [];
      stackHeadPosition = -1;
      get length() {
        return this.stackHeadPosition + 1;
      }
      top() {
        return this.stack[this.stackHeadPosition];
      }
      pushArrayState(size) {
        const state = this.getUninitializedStateFromPool();
        state.type = STATE_ARRAY;
        state.position = 0;
        state.size = size;
        state.array = new Array(size);
      }
      pushMapState(size) {
        const state = this.getUninitializedStateFromPool();
        state.type = STATE_MAP_KEY;
        state.readCount = 0;
        state.size = size;
        state.map = {};
      }
      getUninitializedStateFromPool() {
        this.stackHeadPosition++;
        if (this.stackHeadPosition === this.stack.length) {
          const partialState = {
            type: void 0,
            size: 0,
            array: void 0,
            position: 0,
            readCount: 0,
            map: void 0,
            key: null
          };
          this.stack.push(partialState);
        }
        return this.stack[this.stackHeadPosition];
      }
      release(state) {
        const topStackState = this.stack[this.stackHeadPosition];
        if (topStackState !== state) {
          throw new Error("Invalid stack state. Released state is not on top of the stack.");
        }
        if (state.type === STATE_ARRAY) {
          const partialState = state;
          partialState.size = 0;
          partialState.array = void 0;
          partialState.position = 0;
          partialState.type = void 0;
        }
        if (state.type === STATE_MAP_KEY || state.type === STATE_MAP_VALUE) {
          const partialState = state;
          partialState.size = 0;
          partialState.map = void 0;
          partialState.readCount = 0;
          partialState.type = void 0;
        }
        this.stackHeadPosition--;
      }
      reset() {
        this.stack.length = 0;
        this.stackHeadPosition = -1;
      }
    };
    var HEAD_BYTE_REQUIRED = -1;
    var EMPTY_VIEW = new DataView(new ArrayBuffer(0));
    var EMPTY_BYTES = new Uint8Array(EMPTY_VIEW.buffer);
    try {
      EMPTY_VIEW.getInt8(0);
    } catch (e) {
      if (!(e instanceof RangeError)) {
        throw new Error("This module is not supported in the current JavaScript engine because DataView does not throw RangeError on out-of-bounds access");
      }
    }
    var MORE_DATA = new RangeError("Insufficient data");
    var sharedCachedKeyDecoder = new CachedKeyDecoder_ts_1.CachedKeyDecoder();
    var Decoder = class _Decoder {
      static {
        __name(this, "Decoder");
      }
      extensionCodec;
      context;
      useBigInt64;
      rawStrings;
      maxStrLength;
      maxBinLength;
      maxArrayLength;
      maxMapLength;
      maxExtLength;
      keyDecoder;
      mapKeyConverter;
      totalPos = 0;
      pos = 0;
      view = EMPTY_VIEW;
      bytes = EMPTY_BYTES;
      headByte = HEAD_BYTE_REQUIRED;
      stack = new StackPool();
      entered = false;
      constructor(options) {
        this.extensionCodec = options?.extensionCodec ?? ExtensionCodec_ts_1.ExtensionCodec.defaultCodec;
        this.context = options?.context;
        this.useBigInt64 = options?.useBigInt64 ?? false;
        this.rawStrings = options?.rawStrings ?? false;
        this.maxStrLength = options?.maxStrLength ?? int_ts_1.UINT32_MAX;
        this.maxBinLength = options?.maxBinLength ?? int_ts_1.UINT32_MAX;
        this.maxArrayLength = options?.maxArrayLength ?? int_ts_1.UINT32_MAX;
        this.maxMapLength = options?.maxMapLength ?? int_ts_1.UINT32_MAX;
        this.maxExtLength = options?.maxExtLength ?? int_ts_1.UINT32_MAX;
        this.keyDecoder = options?.keyDecoder !== void 0 ? options.keyDecoder : sharedCachedKeyDecoder;
        this.mapKeyConverter = options?.mapKeyConverter ?? mapKeyConverter;
      }
      clone() {
        return new _Decoder({
          extensionCodec: this.extensionCodec,
          context: this.context,
          useBigInt64: this.useBigInt64,
          rawStrings: this.rawStrings,
          maxStrLength: this.maxStrLength,
          maxBinLength: this.maxBinLength,
          maxArrayLength: this.maxArrayLength,
          maxMapLength: this.maxMapLength,
          maxExtLength: this.maxExtLength,
          keyDecoder: this.keyDecoder
        });
      }
      reinitializeState() {
        this.totalPos = 0;
        this.headByte = HEAD_BYTE_REQUIRED;
        this.stack.reset();
      }
      setBuffer(buffer) {
        const bytes = (0, typedArrays_ts_1.ensureUint8Array)(buffer);
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.pos = 0;
      }
      appendBuffer(buffer) {
        if (this.headByte === HEAD_BYTE_REQUIRED && !this.hasRemaining(1)) {
          this.setBuffer(buffer);
        } else {
          const remainingData = this.bytes.subarray(this.pos);
          const newData = (0, typedArrays_ts_1.ensureUint8Array)(buffer);
          const newBuffer = new Uint8Array(remainingData.length + newData.length);
          newBuffer.set(remainingData);
          newBuffer.set(newData, remainingData.length);
          this.setBuffer(newBuffer);
        }
      }
      hasRemaining(size) {
        return this.view.byteLength - this.pos >= size;
      }
      createExtraByteError(posToShow) {
        const { view, pos } = this;
        return new RangeError(`Extra ${view.byteLength - pos} of ${view.byteLength} byte(s) found at buffer[${posToShow}]`);
      }
      /**
       * @throws {@link DecodeError}
       * @throws {@link RangeError}
       */
      decode(buffer) {
        if (this.entered) {
          const instance = this.clone();
          return instance.decode(buffer);
        }
        try {
          this.entered = true;
          this.reinitializeState();
          this.setBuffer(buffer);
          const object = this.doDecodeSync();
          if (this.hasRemaining(1)) {
            throw this.createExtraByteError(this.pos);
          }
          return object;
        } finally {
          this.entered = false;
        }
      }
      *decodeMulti(buffer) {
        if (this.entered) {
          const instance = this.clone();
          yield* instance.decodeMulti(buffer);
          return;
        }
        try {
          this.entered = true;
          this.reinitializeState();
          this.setBuffer(buffer);
          while (this.hasRemaining(1)) {
            yield this.doDecodeSync();
          }
        } finally {
          this.entered = false;
        }
      }
      async decodeAsync(stream) {
        if (this.entered) {
          const instance = this.clone();
          return instance.decodeAsync(stream);
        }
        try {
          this.entered = true;
          let decoded = false;
          let object;
          for await (const buffer of stream) {
            if (decoded) {
              this.entered = false;
              throw this.createExtraByteError(this.totalPos);
            }
            this.appendBuffer(buffer);
            try {
              object = this.doDecodeSync();
              decoded = true;
            } catch (e) {
              if (!(e instanceof RangeError)) {
                throw e;
              }
            }
            this.totalPos += this.pos;
          }
          if (decoded) {
            if (this.hasRemaining(1)) {
              throw this.createExtraByteError(this.totalPos);
            }
            return object;
          }
          const { headByte, pos, totalPos } = this;
          throw new RangeError(`Insufficient data in parsing ${(0, prettyByte_ts_1.prettyByte)(headByte)} at ${totalPos} (${pos} in the current buffer)`);
        } finally {
          this.entered = false;
        }
      }
      decodeArrayStream(stream) {
        return this.decodeMultiAsync(stream, true);
      }
      decodeStream(stream) {
        return this.decodeMultiAsync(stream, false);
      }
      async *decodeMultiAsync(stream, isArray) {
        if (this.entered) {
          const instance = this.clone();
          yield* instance.decodeMultiAsync(stream, isArray);
          return;
        }
        try {
          this.entered = true;
          let isArrayHeaderRequired = isArray;
          let arrayItemsLeft = -1;
          for await (const buffer of stream) {
            if (isArray && arrayItemsLeft === 0) {
              throw this.createExtraByteError(this.totalPos);
            }
            this.appendBuffer(buffer);
            if (isArrayHeaderRequired) {
              arrayItemsLeft = this.readArraySize();
              isArrayHeaderRequired = false;
              this.complete();
            }
            try {
              while (true) {
                yield this.doDecodeSync();
                if (--arrayItemsLeft === 0) {
                  break;
                }
              }
            } catch (e) {
              if (!(e instanceof RangeError)) {
                throw e;
              }
            }
            this.totalPos += this.pos;
          }
        } finally {
          this.entered = false;
        }
      }
      doDecodeSync() {
        DECODE: while (true) {
          const headByte = this.readHeadByte();
          let object;
          if (headByte >= 224) {
            object = headByte - 256;
          } else if (headByte < 192) {
            if (headByte < 128) {
              object = headByte;
            } else if (headByte < 144) {
              const size = headByte - 128;
              if (size !== 0) {
                this.pushMapState(size);
                this.complete();
                continue DECODE;
              } else {
                object = {};
              }
            } else if (headByte < 160) {
              const size = headByte - 144;
              if (size !== 0) {
                this.pushArrayState(size);
                this.complete();
                continue DECODE;
              } else {
                object = [];
              }
            } else {
              const byteLength = headByte - 160;
              object = this.decodeString(byteLength, 0);
            }
          } else if (headByte === 192) {
            object = null;
          } else if (headByte === 194) {
            object = false;
          } else if (headByte === 195) {
            object = true;
          } else if (headByte === 202) {
            object = this.readF32();
          } else if (headByte === 203) {
            object = this.readF64();
          } else if (headByte === 204) {
            object = this.readU8();
          } else if (headByte === 205) {
            object = this.readU16();
          } else if (headByte === 206) {
            object = this.readU32();
          } else if (headByte === 207) {
            if (this.useBigInt64) {
              object = this.readU64AsBigInt();
            } else {
              object = this.readU64();
            }
          } else if (headByte === 208) {
            object = this.readI8();
          } else if (headByte === 209) {
            object = this.readI16();
          } else if (headByte === 210) {
            object = this.readI32();
          } else if (headByte === 211) {
            if (this.useBigInt64) {
              object = this.readI64AsBigInt();
            } else {
              object = this.readI64();
            }
          } else if (headByte === 217) {
            const byteLength = this.lookU8();
            object = this.decodeString(byteLength, 1);
          } else if (headByte === 218) {
            const byteLength = this.lookU16();
            object = this.decodeString(byteLength, 2);
          } else if (headByte === 219) {
            const byteLength = this.lookU32();
            object = this.decodeString(byteLength, 4);
          } else if (headByte === 220) {
            const size = this.readU16();
            if (size !== 0) {
              this.pushArrayState(size);
              this.complete();
              continue DECODE;
            } else {
              object = [];
            }
          } else if (headByte === 221) {
            const size = this.readU32();
            if (size !== 0) {
              this.pushArrayState(size);
              this.complete();
              continue DECODE;
            } else {
              object = [];
            }
          } else if (headByte === 222) {
            const size = this.readU16();
            if (size !== 0) {
              this.pushMapState(size);
              this.complete();
              continue DECODE;
            } else {
              object = {};
            }
          } else if (headByte === 223) {
            const size = this.readU32();
            if (size !== 0) {
              this.pushMapState(size);
              this.complete();
              continue DECODE;
            } else {
              object = {};
            }
          } else if (headByte === 196) {
            const size = this.lookU8();
            object = this.decodeBinary(size, 1);
          } else if (headByte === 197) {
            const size = this.lookU16();
            object = this.decodeBinary(size, 2);
          } else if (headByte === 198) {
            const size = this.lookU32();
            object = this.decodeBinary(size, 4);
          } else if (headByte === 212) {
            object = this.decodeExtension(1, 0);
          } else if (headByte === 213) {
            object = this.decodeExtension(2, 0);
          } else if (headByte === 214) {
            object = this.decodeExtension(4, 0);
          } else if (headByte === 215) {
            object = this.decodeExtension(8, 0);
          } else if (headByte === 216) {
            object = this.decodeExtension(16, 0);
          } else if (headByte === 199) {
            const size = this.lookU8();
            object = this.decodeExtension(size, 1);
          } else if (headByte === 200) {
            const size = this.lookU16();
            object = this.decodeExtension(size, 2);
          } else if (headByte === 201) {
            const size = this.lookU32();
            object = this.decodeExtension(size, 4);
          } else {
            throw new DecodeError_ts_1.DecodeError(`Unrecognized type byte: ${(0, prettyByte_ts_1.prettyByte)(headByte)}`);
          }
          this.complete();
          const stack = this.stack;
          while (stack.length > 0) {
            const state = stack.top();
            if (state.type === STATE_ARRAY) {
              state.array[state.position] = object;
              state.position++;
              if (state.position === state.size) {
                object = state.array;
                stack.release(state);
              } else {
                continue DECODE;
              }
            } else if (state.type === STATE_MAP_KEY) {
              if (object === "__proto__") {
                throw new DecodeError_ts_1.DecodeError("The key __proto__ is not allowed");
              }
              state.key = this.mapKeyConverter(object);
              state.type = STATE_MAP_VALUE;
              continue DECODE;
            } else {
              state.map[state.key] = object;
              state.readCount++;
              if (state.readCount === state.size) {
                object = state.map;
                stack.release(state);
              } else {
                state.key = null;
                state.type = STATE_MAP_KEY;
                continue DECODE;
              }
            }
          }
          return object;
        }
      }
      readHeadByte() {
        if (this.headByte === HEAD_BYTE_REQUIRED) {
          this.headByte = this.readU8();
        }
        return this.headByte;
      }
      complete() {
        this.headByte = HEAD_BYTE_REQUIRED;
      }
      readArraySize() {
        const headByte = this.readHeadByte();
        switch (headByte) {
          case 220:
            return this.readU16();
          case 221:
            return this.readU32();
          default: {
            if (headByte < 160) {
              return headByte - 144;
            } else {
              throw new DecodeError_ts_1.DecodeError(`Unrecognized array type byte: ${(0, prettyByte_ts_1.prettyByte)(headByte)}`);
            }
          }
        }
      }
      pushMapState(size) {
        if (size > this.maxMapLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: map length (${size}) > maxMapLengthLength (${this.maxMapLength})`);
        }
        this.stack.pushMapState(size);
      }
      pushArrayState(size) {
        if (size > this.maxArrayLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: array length (${size}) > maxArrayLength (${this.maxArrayLength})`);
        }
        this.stack.pushArrayState(size);
      }
      decodeString(byteLength, headerOffset) {
        if (!this.rawStrings || this.stateIsMapKey()) {
          return this.decodeUtf8String(byteLength, headerOffset);
        }
        return this.decodeBinary(byteLength, headerOffset);
      }
      /**
       * @throws {@link RangeError}
       */
      decodeUtf8String(byteLength, headerOffset) {
        if (byteLength > this.maxStrLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: UTF-8 byte length (${byteLength}) > maxStrLength (${this.maxStrLength})`);
        }
        if (this.bytes.byteLength < this.pos + headerOffset + byteLength) {
          throw MORE_DATA;
        }
        const offset = this.pos + headerOffset;
        let object;
        if (this.stateIsMapKey() && this.keyDecoder?.canBeCached(byteLength)) {
          object = this.keyDecoder.decode(this.bytes, offset, byteLength);
        } else {
          object = (0, utf8_ts_1.utf8Decode)(this.bytes, offset, byteLength);
        }
        this.pos += headerOffset + byteLength;
        return object;
      }
      stateIsMapKey() {
        if (this.stack.length > 0) {
          const state = this.stack.top();
          return state.type === STATE_MAP_KEY;
        }
        return false;
      }
      /**
       * @throws {@link RangeError}
       */
      decodeBinary(byteLength, headOffset) {
        if (byteLength > this.maxBinLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: bin length (${byteLength}) > maxBinLength (${this.maxBinLength})`);
        }
        if (!this.hasRemaining(byteLength + headOffset)) {
          throw MORE_DATA;
        }
        const offset = this.pos + headOffset;
        const object = this.bytes.subarray(offset, offset + byteLength);
        this.pos += headOffset + byteLength;
        return object;
      }
      decodeExtension(size, headOffset) {
        if (size > this.maxExtLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: ext length (${size}) > maxExtLength (${this.maxExtLength})`);
        }
        const extType = this.view.getInt8(this.pos + headOffset);
        const data = this.decodeBinary(
          size,
          headOffset + 1
          /* extType */
        );
        return this.extensionCodec.decode(data, extType, this.context);
      }
      lookU8() {
        return this.view.getUint8(this.pos);
      }
      lookU16() {
        return this.view.getUint16(this.pos);
      }
      lookU32() {
        return this.view.getUint32(this.pos);
      }
      readU8() {
        const value = this.view.getUint8(this.pos);
        this.pos++;
        return value;
      }
      readI8() {
        const value = this.view.getInt8(this.pos);
        this.pos++;
        return value;
      }
      readU16() {
        const value = this.view.getUint16(this.pos);
        this.pos += 2;
        return value;
      }
      readI16() {
        const value = this.view.getInt16(this.pos);
        this.pos += 2;
        return value;
      }
      readU32() {
        const value = this.view.getUint32(this.pos);
        this.pos += 4;
        return value;
      }
      readI32() {
        const value = this.view.getInt32(this.pos);
        this.pos += 4;
        return value;
      }
      readU64() {
        const value = (0, int_ts_1.getUint64)(this.view, this.pos);
        this.pos += 8;
        return value;
      }
      readI64() {
        const value = (0, int_ts_1.getInt64)(this.view, this.pos);
        this.pos += 8;
        return value;
      }
      readU64AsBigInt() {
        const value = this.view.getBigUint64(this.pos);
        this.pos += 8;
        return value;
      }
      readI64AsBigInt() {
        const value = this.view.getBigInt64(this.pos);
        this.pos += 8;
        return value;
      }
      readF32() {
        const value = this.view.getFloat32(this.pos);
        this.pos += 4;
        return value;
      }
      readF64() {
        const value = this.view.getFloat64(this.pos);
        this.pos += 8;
        return value;
      }
    };
    exports.Decoder = Decoder;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/decode.cjs
var require_decode = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/decode.cjs"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.decode = decode;
    exports.decodeMulti = decodeMulti;
    var Decoder_ts_1 = require_Decoder();
    function decode(buffer, options) {
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decode(buffer);
    }
    __name(decode, "decode");
    function decodeMulti(buffer, options) {
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decodeMulti(buffer);
    }
    __name(decodeMulti, "decodeMulti");
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/utils/stream.cjs
var require_stream = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/utils/stream.cjs"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isAsyncIterable = isAsyncIterable;
    exports.asyncIterableFromStream = asyncIterableFromStream;
    exports.ensureAsyncIterable = ensureAsyncIterable;
    function isAsyncIterable(object) {
      return object[Symbol.asyncIterator] != null;
    }
    __name(isAsyncIterable, "isAsyncIterable");
    async function* asyncIterableFromStream(stream) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            return;
          }
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    }
    __name(asyncIterableFromStream, "asyncIterableFromStream");
    function ensureAsyncIterable(streamLike) {
      if (isAsyncIterable(streamLike)) {
        return streamLike;
      } else {
        return asyncIterableFromStream(streamLike);
      }
    }
    __name(ensureAsyncIterable, "ensureAsyncIterable");
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/decodeAsync.cjs
var require_decodeAsync = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/decodeAsync.cjs"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.decodeAsync = decodeAsync;
    exports.decodeArrayStream = decodeArrayStream;
    exports.decodeMultiStream = decodeMultiStream;
    var Decoder_ts_1 = require_Decoder();
    var stream_ts_1 = require_stream();
    async function decodeAsync(streamLike, options) {
      const stream = (0, stream_ts_1.ensureAsyncIterable)(streamLike);
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decodeAsync(stream);
    }
    __name(decodeAsync, "decodeAsync");
    function decodeArrayStream(streamLike, options) {
      const stream = (0, stream_ts_1.ensureAsyncIterable)(streamLike);
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decodeArrayStream(stream);
    }
    __name(decodeArrayStream, "decodeArrayStream");
    function decodeMultiStream(streamLike, options) {
      const stream = (0, stream_ts_1.ensureAsyncIterable)(streamLike);
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decodeStream(stream);
    }
    __name(decodeMultiStream, "decodeMultiStream");
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/index.cjs
var require_dist2 = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/index.cjs"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.decodeTimestampExtension = exports.encodeTimestampExtension = exports.decodeTimestampToTimeSpec = exports.encodeTimeSpecToTimestamp = exports.encodeDateToTimeSpec = exports.EXT_TIMESTAMP = exports.ExtData = exports.ExtensionCodec = exports.Encoder = exports.DecodeError = exports.Decoder = exports.decodeMultiStream = exports.decodeArrayStream = exports.decodeAsync = exports.decodeMulti = exports.decode = exports.encode = void 0;
    var encode_ts_1 = require_encode();
    Object.defineProperty(exports, "encode", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return encode_ts_1.encode;
    }, "get") });
    var decode_ts_1 = require_decode();
    Object.defineProperty(exports, "decode", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return decode_ts_1.decode;
    }, "get") });
    Object.defineProperty(exports, "decodeMulti", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return decode_ts_1.decodeMulti;
    }, "get") });
    var decodeAsync_ts_1 = require_decodeAsync();
    Object.defineProperty(exports, "decodeAsync", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return decodeAsync_ts_1.decodeAsync;
    }, "get") });
    Object.defineProperty(exports, "decodeArrayStream", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return decodeAsync_ts_1.decodeArrayStream;
    }, "get") });
    Object.defineProperty(exports, "decodeMultiStream", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return decodeAsync_ts_1.decodeMultiStream;
    }, "get") });
    var Decoder_ts_1 = require_Decoder();
    Object.defineProperty(exports, "Decoder", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return Decoder_ts_1.Decoder;
    }, "get") });
    var DecodeError_ts_1 = require_DecodeError();
    Object.defineProperty(exports, "DecodeError", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return DecodeError_ts_1.DecodeError;
    }, "get") });
    var Encoder_ts_1 = require_Encoder();
    Object.defineProperty(exports, "Encoder", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return Encoder_ts_1.Encoder;
    }, "get") });
    var ExtensionCodec_ts_1 = require_ExtensionCodec();
    Object.defineProperty(exports, "ExtensionCodec", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return ExtensionCodec_ts_1.ExtensionCodec;
    }, "get") });
    var ExtData_ts_1 = require_ExtData();
    Object.defineProperty(exports, "ExtData", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return ExtData_ts_1.ExtData;
    }, "get") });
    var timestamp_ts_1 = require_timestamp();
    Object.defineProperty(exports, "EXT_TIMESTAMP", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return timestamp_ts_1.EXT_TIMESTAMP;
    }, "get") });
    Object.defineProperty(exports, "encodeDateToTimeSpec", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return timestamp_ts_1.encodeDateToTimeSpec;
    }, "get") });
    Object.defineProperty(exports, "encodeTimeSpecToTimestamp", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return timestamp_ts_1.encodeTimeSpecToTimestamp;
    }, "get") });
    Object.defineProperty(exports, "decodeTimestampToTimeSpec", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return timestamp_ts_1.decodeTimestampToTimeSpec;
    }, "get") });
    Object.defineProperty(exports, "encodeTimestampExtension", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return timestamp_ts_1.encodeTimestampExtension;
    }, "get") });
    Object.defineProperty(exports, "decodeTimestampExtension", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return timestamp_ts_1.decodeTimestampExtension;
    }, "get") });
  }
});

// node_modules/robot3/dist/machine.js
var require_machine = __commonJS({
  "node_modules/robot3/dist/machine.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    function valueEnumerable(value) {
      return { enumerable: true, value };
    }
    __name(valueEnumerable, "valueEnumerable");
    function valueEnumerableWritable(value) {
      return { enumerable: true, writable: true, value };
    }
    __name(valueEnumerableWritable, "valueEnumerableWritable");
    var d = {};
    var truthy = /* @__PURE__ */ __name(() => true, "truthy");
    var empty = /* @__PURE__ */ __name(() => ({}), "empty");
    var identity = /* @__PURE__ */ __name((a) => a, "identity");
    var callBoth = /* @__PURE__ */ __name((par, fn, self, args) => par.apply(self, args) && fn.apply(self, args), "callBoth");
    var callForward = /* @__PURE__ */ __name((par, fn, self, [a, b]) => fn.call(self, par.call(self, a, b), b), "callForward");
    var create = /* @__PURE__ */ __name((a, b) => Object.freeze(Object.create(a, b)), "create");
    function stack(fns, def, caller) {
      return fns.reduce((par, fn) => {
        return function(...args) {
          return caller(par, fn, this, args);
        };
      }, def);
    }
    __name(stack, "stack");
    function fnType(fn) {
      return create(this, { fn: valueEnumerable(fn) });
    }
    __name(fnType, "fnType");
    var reduceType = {};
    var reduce = fnType.bind(reduceType);
    var action = /* @__PURE__ */ __name((fn) => reduce((ctx, ev) => !!~fn(ctx, ev) && ctx), "action");
    var guardType = {};
    var guard = fnType.bind(guardType);
    function filter(Type, arr) {
      return arr.filter((value) => Type.isPrototypeOf(value));
    }
    __name(filter, "filter");
    function makeTransition(from, to, ...args) {
      let guards = stack(filter(guardType, args).map((t) => t.fn), truthy, callBoth);
      let reducers = stack(filter(reduceType, args).map((t) => t.fn), identity, callForward);
      return create(this, {
        from: valueEnumerable(from),
        to: valueEnumerable(to),
        guards: valueEnumerable(guards),
        reducers: valueEnumerable(reducers)
      });
    }
    __name(makeTransition, "makeTransition");
    var transitionType = {};
    var immediateType = {};
    var transition = makeTransition.bind(transitionType);
    var immediate = makeTransition.bind(immediateType, null);
    function enterImmediate(machine2, service2, event) {
      return transitionTo(service2, machine2, event, this.immediates) || machine2;
    }
    __name(enterImmediate, "enterImmediate");
    function transitionsToMap(transitions) {
      let m = /* @__PURE__ */ new Map();
      for (let t of transitions) {
        if (!m.has(t.from)) m.set(t.from, []);
        m.get(t.from).push(t);
      }
      return m;
    }
    __name(transitionsToMap, "transitionsToMap");
    var stateType = { enter: identity };
    function state(...args) {
      let transitions = filter(transitionType, args);
      let immediates = filter(immediateType, args);
      let desc = {
        final: valueEnumerable(args.length === 0),
        transitions: valueEnumerable(transitionsToMap(transitions))
      };
      if (immediates.length) {
        desc.immediates = valueEnumerable(immediates);
        desc.enter = valueEnumerable(enterImmediate);
      }
      return create(stateType, desc);
    }
    __name(state, "state");
    var invokeFnType = {
      enter(machine2, service2, event) {
        let rn = this.fn.call(service2, service2.context, event);
        if (machine.isPrototypeOf(rn))
          return create(invokeMachineType, {
            machine: valueEnumerable(rn),
            transitions: valueEnumerable(this.transitions)
          }).enter(machine2, service2, event);
        rn.then((data) => service2.send({ type: "done", data })).catch((error) => service2.send({ type: "error", error }));
        return machine2;
      }
    };
    var invokeMachineType = {
      enter(machine2, service2, event) {
        service2.child = interpret(this.machine, (s) => {
          service2.onChange(s);
          if (service2.child == s && s.machine.state.value.final) {
            delete service2.child;
            service2.send({ type: "done", data: s.context });
          }
        }, service2.context, event);
        if (service2.child.machine.state.value.final) {
          let data = service2.child.context;
          delete service2.child;
          return transitionTo(service2, machine2, { type: "done", data }, this.transitions.get("done"));
        }
        return machine2;
      }
    };
    function invoke(fn, ...transitions) {
      let t = valueEnumerable(transitionsToMap(transitions));
      return machine.isPrototypeOf(fn) ? create(invokeMachineType, {
        machine: valueEnumerable(fn),
        transitions: t
      }) : create(invokeFnType, {
        fn: valueEnumerable(fn),
        transitions: t
      });
    }
    __name(invoke, "invoke");
    var machine = {
      get state() {
        return {
          name: this.current,
          value: this.states[this.current]
        };
      }
    };
    function createMachine(current, states, contextFn = empty) {
      if (typeof current !== "string") {
        contextFn = states || empty;
        states = current;
        current = Object.keys(states)[0];
      }
      if (d._create) d._create(current, states);
      return create(machine, {
        context: valueEnumerable(contextFn),
        current: valueEnumerable(current),
        states: valueEnumerable(states)
      });
    }
    __name(createMachine, "createMachine");
    function transitionTo(service2, machine2, fromEvent, candidates) {
      let { context } = service2;
      for (let { to, guards, reducers } of candidates) {
        if (guards(context, fromEvent)) {
          service2.context = reducers.call(service2, context, fromEvent);
          let original = machine2.original || machine2;
          let newMachine = create(original, {
            current: valueEnumerable(to),
            original: { value: original }
          });
          if (d._onEnter) d._onEnter(machine2, to, service2.context, context, fromEvent);
          let state2 = newMachine.state.value;
          return state2.enter(newMachine, service2, fromEvent);
        }
      }
    }
    __name(transitionTo, "transitionTo");
    function send(service2, event) {
      let eventName = event.type || event;
      let { machine: machine2 } = service2;
      let { value: state2, name: currentStateName } = machine2.state;
      if (state2.transitions.has(eventName)) {
        return transitionTo(service2, machine2, event, state2.transitions.get(eventName)) || machine2;
      } else {
        if (d._send) d._send(eventName, currentStateName);
      }
      return machine2;
    }
    __name(send, "send");
    var service = {
      send(event) {
        this.machine = send(this, event);
        this.onChange(this);
      }
    };
    function interpret(machine2, onChange, initialContext, event) {
      let s = Object.create(service, {
        machine: valueEnumerableWritable(machine2),
        context: valueEnumerableWritable(machine2.context(initialContext, event)),
        onChange: valueEnumerable(onChange)
      });
      s.send = s.send.bind(s);
      s.machine = s.machine.state.value.enter(s.machine, s, event);
      return s;
    }
    __name(interpret, "interpret");
    exports.action = action;
    exports.createMachine = createMachine;
    exports.d = d;
    exports.guard = guard;
    exports.immediate = immediate;
    exports.interpret = interpret;
    exports.invoke = invoke;
    exports.reduce = reduce;
    exports.state = state;
    exports.transition = transition;
  }
});

// node_modules/@fal-ai/client/src/realtime.js
var require_realtime = __commonJS({
  "node_modules/@fal-ai/client/src/realtime.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    var __awaiter = exports && exports.__awaiter || function(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function(resolve) {
          resolve(value);
        });
      }
      __name(adopt, "adopt");
      return new (P || (P = Promise))(function(resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }
        __name(fulfilled, "fulfilled");
        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }
        __name(rejected, "rejected");
        function step(result2) {
          result2.done ? resolve(result2.value) : adopt(result2.value).then(fulfilled, rejected);
        }
        __name(step, "step");
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createRealtimeClient = createRealtimeClient;
    var msgpack_1 = require_dist2();
    var robot3_1 = require_machine();
    var auth_1 = require_auth();
    var response_1 = require_response();
    var runtime_1 = require_runtime();
    var utils_1 = require_utils();
    var initialState = /* @__PURE__ */ __name(() => ({
      enqueuedMessage: void 0
    }), "initialState");
    function hasToken(context) {
      return context.token !== void 0;
    }
    __name(hasToken, "hasToken");
    function noToken(context) {
      return !hasToken(context);
    }
    __name(noToken, "noToken");
    function enqueueMessage(context, event) {
      return Object.assign(Object.assign({}, context), { enqueuedMessage: event.message });
    }
    __name(enqueueMessage, "enqueueMessage");
    function closeConnection(context) {
      if (context.websocket && context.websocket.readyState === WebSocket.OPEN) {
        context.websocket.close();
      }
      return Object.assign(Object.assign({}, context), { websocket: void 0 });
    }
    __name(closeConnection, "closeConnection");
    function sendMessage(context, event) {
      if (context.websocket && context.websocket.readyState === WebSocket.OPEN) {
        if (event.message instanceof Uint8Array) {
          context.websocket.send(event.message);
        } else if (typeof event.message === "string") {
          context.websocket.send(event.message);
        } else {
          context.websocket.send((0, msgpack_1.encode)(event.message));
        }
        return Object.assign(Object.assign({}, context), { enqueuedMessage: void 0 });
      }
      return Object.assign(Object.assign({}, context), { enqueuedMessage: event.message });
    }
    __name(sendMessage, "sendMessage");
    function expireToken(context) {
      return Object.assign(Object.assign({}, context), { token: void 0 });
    }
    __name(expireToken, "expireToken");
    function setToken(context, event) {
      return Object.assign(Object.assign({}, context), { token: event.token });
    }
    __name(setToken, "setToken");
    function connectionEstablished(context, event) {
      return Object.assign(Object.assign({}, context), { websocket: event.websocket });
    }
    __name(connectionEstablished, "connectionEstablished");
    var connectionStateMachine = (0, robot3_1.createMachine)("idle", {
      idle: (0, robot3_1.state)((0, robot3_1.transition)("send", "connecting", (0, robot3_1.reduce)(enqueueMessage)), (0, robot3_1.transition)("close", "idle", (0, robot3_1.reduce)(closeConnection))),
      connecting: (0, robot3_1.state)((0, robot3_1.transition)("connecting", "connecting"), (0, robot3_1.transition)("connected", "active", (0, robot3_1.reduce)(connectionEstablished)), (0, robot3_1.transition)("connectionClosed", "idle", (0, robot3_1.reduce)(closeConnection)), (0, robot3_1.transition)("send", "connecting", (0, robot3_1.reduce)(enqueueMessage)), (0, robot3_1.transition)("close", "idle", (0, robot3_1.reduce)(closeConnection)), (0, robot3_1.immediate)("authRequired", (0, robot3_1.guard)(noToken))),
      authRequired: (0, robot3_1.state)((0, robot3_1.transition)("initiateAuth", "authInProgress"), (0, robot3_1.transition)("send", "authRequired", (0, robot3_1.reduce)(enqueueMessage)), (0, robot3_1.transition)("close", "idle", (0, robot3_1.reduce)(closeConnection))),
      authInProgress: (0, robot3_1.state)((0, robot3_1.transition)("authenticated", "connecting", (0, robot3_1.reduce)(setToken)), (0, robot3_1.transition)("unauthorized", "idle", (0, robot3_1.reduce)(expireToken), (0, robot3_1.reduce)(closeConnection)), (0, robot3_1.transition)("send", "authInProgress", (0, robot3_1.reduce)(enqueueMessage)), (0, robot3_1.transition)("close", "idle", (0, robot3_1.reduce)(closeConnection))),
      active: (0, robot3_1.state)((0, robot3_1.transition)("send", "active", (0, robot3_1.reduce)(sendMessage)), (0, robot3_1.transition)("authenticated", "active", (0, robot3_1.reduce)(setToken)), (0, robot3_1.transition)("unauthorized", "idle", (0, robot3_1.reduce)(expireToken)), (0, robot3_1.transition)("connectionClosed", "idle", (0, robot3_1.reduce)(expireToken), (0, robot3_1.reduce)(closeConnection)), (0, robot3_1.transition)("close", "idle", (0, robot3_1.reduce)(expireToken), (0, robot3_1.reduce)(closeConnection)))
    }, initialState);
    function buildRealtimeUrl(app, { token, maxBuffering, path }) {
      var _a;
      if (maxBuffering !== void 0 && (maxBuffering < 1 || maxBuffering > 60)) {
        throw new Error("The `maxBuffering` must be between 1 and 60 (inclusive)");
      }
      const queryParams2 = new URLSearchParams({
        fal_jwt_token: token
      });
      if (maxBuffering !== void 0) {
        queryParams2.set("max_buffering", maxBuffering.toFixed(0));
      }
      const appId = (0, utils_1.ensureEndpointIdFormat)(app);
      const resolvedPath = (_a = (0, utils_1.resolveEndpointPath)(app, path, "/realtime")) !== null && _a !== void 0 ? _a : "";
      return `wss://fal.run/${appId}${resolvedPath}?${queryParams2.toString()}`;
    }
    __name(buildRealtimeUrl, "buildRealtimeUrl");
    var DEFAULT_THROTTLE_INTERVAL = 128;
    function isUnauthorizedError(message) {
      return message["status"] === "error" && message["error"] === "Unauthorized";
    }
    __name(isUnauthorizedError, "isUnauthorizedError");
    var WebSocketErrorCodes = {
      NORMAL_CLOSURE: 1e3,
      GOING_AWAY: 1001
    };
    var connectionCache = /* @__PURE__ */ new Map();
    var connectionCallbacks = /* @__PURE__ */ new Map();
    function reuseInterpreter(key, throttleInterval, onChange) {
      if (!connectionCache.has(key)) {
        const service = (0, robot3_1.interpret)(connectionStateMachine, onChange);
        connectionCache.set(key, {
          service,
          throttledSend: throttleInterval > 0 ? (0, utils_1.throttle)(service.send, throttleInterval, true) : service.send
        });
      }
      return connectionCache.get(key);
    }
    __name(reuseInterpreter, "reuseInterpreter");
    var noop = /* @__PURE__ */ __name(() => {
    }, "noop");
    var NoOpConnection = {
      send: noop,
      close: noop
    };
    function isSuccessfulResult(data) {
      return data.status !== "error" && data.type !== "x-fal-message" && !isFalErrorResult(data);
    }
    __name(isSuccessfulResult, "isSuccessfulResult");
    function isFalErrorResult(data) {
      return data.type === "x-fal-error";
    }
    __name(isFalErrorResult, "isFalErrorResult");
    function decodeRealtimeMessage(data) {
      return __awaiter(this, void 0, void 0, function* () {
        if (typeof data === "string") {
          return JSON.parse(data);
        }
        const toUint8Array = /* @__PURE__ */ __name((value) => __awaiter(this, void 0, void 0, function* () {
          if (value instanceof Uint8Array) {
            return value;
          }
          if (value instanceof Blob) {
            return new Uint8Array(yield value.arrayBuffer());
          }
          return new Uint8Array(value);
        }), "toUint8Array");
        if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
          return (0, msgpack_1.decode)(yield toUint8Array(data));
        }
        if (data instanceof Blob) {
          return (0, msgpack_1.decode)(yield toUint8Array(data));
        }
        return data;
      });
    }
    __name(decodeRealtimeMessage, "decodeRealtimeMessage");
    function encodeRealtimeMessage(input) {
      if (input instanceof Uint8Array) {
        return input;
      }
      if (typeof input === "string") {
        return (0, msgpack_1.encode)(input);
      }
      return (0, msgpack_1.encode)(input);
    }
    __name(encodeRealtimeMessage, "encodeRealtimeMessage");
    function handleRealtimeMessage({ data, decodeMessage, onResult, onError, send }) {
      const handleDecoded = /* @__PURE__ */ __name((decoded) => {
        if (isUnauthorizedError(decoded)) {
          send({
            type: "unauthorized",
            error: new Error("Unauthorized")
          });
          return;
        }
        if (isSuccessfulResult(decoded)) {
          onResult(decoded);
          return;
        }
        if (isFalErrorResult(decoded)) {
          if (decoded.error === "TIMEOUT") {
            return;
          }
          onError(new response_1.ApiError({
            message: `${decoded.error}: ${decoded.reason}`,
            // TODO better error status code
            status: 400,
            body: decoded
          }));
          return;
        }
      }, "handleDecoded");
      Promise.resolve(decodeMessage ? decodeMessage(data) : data).then(handleDecoded).catch((error) => {
        var _a;
        onError(new response_1.ApiError({
          message: (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : "Failed to decode realtime message",
          status: 400
        }));
      });
    }
    __name(handleRealtimeMessage, "handleRealtimeMessage");
    function createRealtimeClient({ config }) {
      return {
        connect(app, handler) {
          const {
            // if running on React in the server, set clientOnly to true by default
            clientOnly = (0, utils_1.isReact)() && !(0, runtime_1.isBrowser)(),
            connectionKey = crypto.randomUUID(),
            maxBuffering,
            path,
            throttleInterval = DEFAULT_THROTTLE_INTERVAL,
            encodeMessage: encodeMessageOverride,
            decodeMessage: decodeMessageOverride,
            tokenProvider,
            tokenExpirationSeconds
          } = handler;
          if (clientOnly && !(0, runtime_1.isBrowser)()) {
            return NoOpConnection;
          }
          const encodeMessageFn = encodeMessageOverride !== null && encodeMessageOverride !== void 0 ? encodeMessageOverride : ((input) => encodeRealtimeMessage(input));
          const decodeMessageFn = decodeMessageOverride !== null && decodeMessageOverride !== void 0 ? decodeMessageOverride : ((data) => decodeRealtimeMessage(data));
          let previousState;
          let latestEnqueuedMessage;
          let tokenRefreshTimer;
          let tokenRefreshGeneration = 0;
          connectionCallbacks.set(connectionKey, {
            decodeMessage: decodeMessageFn,
            onError: handler.onError,
            onResult: handler.onResult
          });
          const getCallbacks = /* @__PURE__ */ __name(() => connectionCallbacks.get(connectionKey), "getCallbacks");
          const stateMachine = reuseInterpreter(connectionKey, throttleInterval, ({ context, machine, send: send2 }) => {
            var _a;
            const { enqueuedMessage, token, websocket } = context;
            latestEnqueuedMessage = enqueuedMessage;
            if (machine.current === "active" && enqueuedMessage && (websocket === null || websocket === void 0 ? void 0 : websocket.readyState) === WebSocket.OPEN) {
              send2({ type: "send", message: enqueuedMessage });
            }
            if (machine.current === "authRequired" && token === void 0 && previousState !== machine.current) {
              send2({ type: "initiateAuth" });
              tokenRefreshGeneration++;
              const generation = tokenRefreshGeneration;
              const appId = (0, utils_1.ensureEndpointIdFormat)(app);
              const resolvedPath = (_a = (0, utils_1.resolveEndpointPath)(app, path, "/realtime")) !== null && _a !== void 0 ? _a : "";
              const fetchToken = tokenProvider ? () => tokenProvider(`${appId}${resolvedPath}`) : () => {
                console.warn("[fal.realtime] Using the default token provider is deprecated. Please provide a `tokenProvider` function to `fal.realtime.connect()`. See https://docs.fal.ai/model-apis/client#client-side-usage-with-token-provider for more information.");
                return (0, auth_1.getTemporaryAuthToken)(app, config);
              };
              const effectiveExpiration = tokenProvider ? tokenExpirationSeconds : auth_1.TOKEN_EXPIRATION_SECONDS;
              const scheduleTokenRefresh = effectiveExpiration !== void 0 ? () => {
                clearTimeout(tokenRefreshTimer);
                const refreshMs = Math.round(effectiveExpiration * 0.9 * 1e3);
                tokenRefreshTimer = setTimeout(() => {
                  if (generation !== tokenRefreshGeneration) {
                    return;
                  }
                  fetchToken().then((newToken) => {
                    if (generation !== tokenRefreshGeneration) {
                      return;
                    }
                    queueMicrotask(() => {
                      send2({ type: "authenticated", token: newToken });
                    });
                    scheduleTokenRefresh();
                  }).catch(() => {
                    if (generation !== tokenRefreshGeneration) {
                      return;
                    }
                    const retryMs = Math.round(effectiveExpiration * 0.05 * 1e3);
                    tokenRefreshTimer = setTimeout(() => {
                      scheduleTokenRefresh();
                    }, retryMs);
                  });
                }, refreshMs);
              } : noop;
              fetchToken().then((token2) => {
                queueMicrotask(() => {
                  send2({ type: "authenticated", token: token2 });
                });
                scheduleTokenRefresh();
              }).catch((error) => {
                queueMicrotask(() => {
                  send2({ type: "unauthorized", error });
                });
              });
            }
            if (machine.current === "connecting" && previousState !== machine.current && token !== void 0) {
              const ws = new WebSocket(buildRealtimeUrl(app, { token, maxBuffering, path }));
              ws.onopen = () => {
                var _a2, _b;
                send2({ type: "connected", websocket: ws });
                const queued = (_b = (_a2 = stateMachine.service.context) === null || _a2 === void 0 ? void 0 : _a2.enqueuedMessage) !== null && _b !== void 0 ? _b : latestEnqueuedMessage;
                if (queued) {
                  ws.send(encodeMessageFn(queued));
                  stateMachine.service.context = Object.assign(Object.assign({}, stateMachine.service.context), { enqueuedMessage: void 0 });
                }
              };
              ws.onclose = (event) => {
                if (event.code !== WebSocketErrorCodes.NORMAL_CLOSURE) {
                  const { onError = noop } = getCallbacks();
                  onError(new response_1.ApiError({
                    message: `Error closing the connection: ${event.reason}`,
                    status: event.code
                  }));
                }
                send2({ type: "connectionClosed", code: event.code });
              };
              ws.onerror = (event) => {
                const { onError = noop } = getCallbacks();
                onError(new response_1.ApiError({ message: "Unknown error", status: 500 }));
              };
              ws.onmessage = (event) => {
                const { decodeMessage = decodeMessageFn, onResult, onError = noop } = getCallbacks();
                handleRealtimeMessage({
                  data: event.data,
                  decodeMessage,
                  onResult,
                  onError,
                  send: send2
                });
              };
            }
            if (previousState === "active" && machine.current !== "active") {
              clearTimeout(tokenRefreshTimer);
              tokenRefreshTimer = void 0;
            }
            previousState = machine.current;
          });
          const send = /* @__PURE__ */ __name((input) => {
            stateMachine.throttledSend({
              type: "send",
              message: encodeMessageFn(input)
            });
          }, "send");
          const close = /* @__PURE__ */ __name(() => {
            stateMachine.service.send({ type: "close" });
          }, "close");
          return {
            send,
            close
          };
        }
      };
    }
    __name(createRealtimeClient, "createRealtimeClient");
  }
});

// node_modules/@fal-ai/client/src/client.js
var require_client = __commonJS({
  "node_modules/@fal-ai/client/src/client.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    var __awaiter = exports && exports.__awaiter || function(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function(resolve) {
          resolve(value);
        });
      }
      __name(adopt, "adopt");
      return new (P || (P = Promise))(function(resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }
        __name(fulfilled, "fulfilled");
        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }
        __name(rejected, "rejected");
        function step(result2) {
          result2.done ? resolve(result2.value) : adopt(result2.value).then(fulfilled, rejected);
        }
        __name(step, "step");
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createFalClient = createFalClient;
    var config_1 = require_config();
    var headers_1 = require_headers();
    var queue_1 = require_queue();
    var realtime_1 = require_realtime();
    var request_1 = require_request();
    var response_1 = require_response();
    var storage_1 = require_storage();
    var streaming_1 = require_streaming();
    function createFalClient(userConfig = {}) {
      const config = (0, config_1.createConfig)(userConfig);
      const storage = (0, storage_1.createStorageClient)({ config });
      const queue = (0, queue_1.createQueueClient)({ config, storage });
      const streaming = (0, streaming_1.createStreamingClient)({ config, storage });
      const realtime = (0, realtime_1.createRealtimeClient)({ config });
      return {
        queue,
        realtime,
        storage,
        streaming,
        stream: streaming.stream,
        run(endpointId_1) {
          return __awaiter(this, arguments, void 0, function* (endpointId, options = {}) {
            const input = options.input ? yield storage.transformInput(options.input) : void 0;
            return (0, request_1.dispatchRequest)({
              method: options.method,
              targetUrl: (0, request_1.buildUrl)(endpointId, options),
              input,
              // TODO: consider supporting custom headers in fal.run() as well
              headers: Object.assign(Object.assign({}, (0, storage_1.buildObjectLifecycleHeaders)(options.storageSettings)), (0, headers_1.buildTimeoutHeaders)(options.startTimeout)),
              config: Object.assign(Object.assign({}, config), { responseHandler: response_1.resultResponseHandler }),
              options: {
                signal: options.abortSignal,
                retry: {
                  maxRetries: 3,
                  baseDelay: 500,
                  maxDelay: 15e3
                }
              }
            });
          });
        },
        subscribe: /* @__PURE__ */ __name((endpointId, options) => __awaiter(this, void 0, void 0, function* () {
          const { request_id: requestId } = yield queue.submit(endpointId, options);
          if (options.onEnqueue) {
            options.onEnqueue(requestId);
          }
          yield queue.subscribeToStatus(endpointId, Object.assign({ requestId }, options));
          return queue.result(endpointId, { requestId });
        }), "subscribe")
      };
    }
    __name(createFalClient, "createFalClient");
  }
});

// node_modules/@fal-ai/client/src/types/common.js
var require_common = __commonJS({
  "node_modules/@fal-ai/client/src/types/common.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isQueueStatus = isQueueStatus;
    exports.isCompletedQueueStatus = isCompletedQueueStatus;
    function isQueueStatus(obj) {
      return obj && obj.status && obj.response_url;
    }
    __name(isQueueStatus, "isQueueStatus");
    function isCompletedQueueStatus(obj) {
      return isQueueStatus(obj) && obj.status === "COMPLETED";
    }
    __name(isCompletedQueueStatus, "isCompletedQueueStatus");
  }
});

// node_modules/@fal-ai/client/src/index.js
var require_src = __commonJS({
  "node_modules/@fal-ai/client/src/index.js"(exports) {
    "use strict";
    init_modules_watch_stub();
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: /* @__PURE__ */ __name(function() {
          return m[k];
        }, "get") };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.fal = exports.parseEndpointId = exports.isRetryableError = exports.ValidationError = exports.ApiError = exports.withProxy = exports.withMiddleware = exports.createFalClient = void 0;
    var client_1 = require_client();
    var client_2 = require_client();
    Object.defineProperty(exports, "createFalClient", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return client_2.createFalClient;
    }, "get") });
    var middleware_1 = require_middleware();
    Object.defineProperty(exports, "withMiddleware", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return middleware_1.withMiddleware;
    }, "get") });
    Object.defineProperty(exports, "withProxy", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return middleware_1.withProxy;
    }, "get") });
    var response_1 = require_response();
    Object.defineProperty(exports, "ApiError", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return response_1.ApiError;
    }, "get") });
    Object.defineProperty(exports, "ValidationError", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return response_1.ValidationError;
    }, "get") });
    var retry_1 = require_retry();
    Object.defineProperty(exports, "isRetryableError", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return retry_1.isRetryableError;
    }, "get") });
    __exportStar(require_common(), exports);
    var utils_1 = require_utils();
    Object.defineProperty(exports, "parseEndpointId", { enumerable: true, get: /* @__PURE__ */ __name(function() {
      return utils_1.parseEndpointId;
    }, "get") });
    exports.fal = (/* @__PURE__ */ __name((function createSingletonFalClient() {
      let currentInstance = (0, client_1.createFalClient)();
      return {
        config(config) {
          currentInstance = (0, client_1.createFalClient)(config);
        },
        get queue() {
          return currentInstance.queue;
        },
        get realtime() {
          return currentInstance.realtime;
        },
        get storage() {
          return currentInstance.storage;
        },
        get streaming() {
          return currentInstance.streaming;
        },
        run(id, options) {
          return currentInstance.run(id, options);
        },
        subscribe(endpointId, options) {
          return currentInstance.subscribe(endpointId, options);
        },
        stream(endpointId, options) {
          return currentInstance.stream(endpointId, options);
        }
      };
    }), "createSingletonFalClient"))();
  }
});

// .wrangler/tmp/bundle-3BnKMC/middleware-loader.entry.ts
init_modules_watch_stub();

// .wrangler/tmp/bundle-3BnKMC/middleware-insertion-facade.js
init_modules_watch_stub();

// src/entry.js
init_modules_watch_stub();

// src/index.js
init_modules_watch_stub();

// src/lib/http.js
init_modules_watch_stub();
var JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
var DEFAULT_ORIGINS = [
  "https://matthew.mccluster.org",
  "https://mccluster.org",
  "https://api.mccluster.org",
  "https://esmer.mccluster.org",
  "https://mcclusterishere.github.io",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
];
function allowedOrigins(env) {
  const extra = String(env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  const single = env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== "*" ? [env.ALLOWED_ORIGIN] : [];
  return [.../* @__PURE__ */ new Set([...DEFAULT_ORIGINS, ...single, ...extra])];
}
__name(allowedOrigins, "allowedOrigins");
function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowlist = allowedOrigins(env);
  const allowOrigin = origin && allowlist.includes(origin) ? origin : allowlist[0];
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-we-user-id,x-we-role,stripe-signature",
    "access-control-allow-credentials": "true",
    "access-control-max-age": "86400",
    vary: "Origin"
  };
}
__name(corsHeaders, "corsHeaders");
function applyCors(request, env, response) {
  const headers7 = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) headers7.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers7
  });
}
__name(applyCors, "applyCors");
function reply(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(request, env) }
  });
}
__name(reply, "reply");
function fail(request, env, message, status = 400, detail) {
  return reply(request, env, { error: message, detail }, status);
}
__name(fail, "fail");
function logEvent(level, fields) {
  const line = JSON.stringify({
    level,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    service: "mccluster",
    ...fields
  });
  if (level === "error") console.error(line);
  else console.log(line);
}
__name(logEvent, "logEvent");

// src/whip/identity-gateway.js
init_modules_watch_stub();

// src/whip/security.js
init_modules_watch_stub();

// src/whip/gateway.js
init_modules_watch_stub();

// src/whip/router.js
init_modules_watch_stub();

// src/whip/worker.js
init_modules_watch_stub();

// src/whip/stripe.js
init_modules_watch_stub();
var STRIPE_API = "https://api.stripe.com/v1";
function appendForm(form, key, value) {
  if (value === void 0 || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => appendForm(form, `${key}[${i}]`, item));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([child, item]) => appendForm(form, `${key}[${child}]`, item));
    return;
  }
  form.append(key, String(value));
}
__name(appendForm, "appendForm");
function toForm(params = {}) {
  const form = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => appendForm(form, key, value));
  return form;
}
__name(toForm, "toForm");
function stripeConfigured(env) {
  return Boolean(env.STRIPE_SECRET_KEY);
}
__name(stripeConfigured, "stripeConfigured");
async function stripeRequest(env, path, params = {}, options = {}) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured");
  const method = options.method || "POST";
  const form = toForm(params);
  const url = new URL(`${STRIPE_API}/${path.replace(/^\//, "")}`);
  if (method === "GET") {
    for (const [key, value] of form.entries()) url.searchParams.append(key, value);
  }
  const headers7 = {
    authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    "content-type": "application/x-www-form-urlencoded"
  };
  if (options.account) headers7["Stripe-Account"] = options.account;
  const response = await fetch(url, { method, headers: headers7, body: method === "GET" ? void 0 : form.toString() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `Stripe request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.stripe = data?.error || null;
    throw error;
  }
  return data;
}
__name(stripeRequest, "stripeRequest");
function connectedAccountReady(account) {
  return Boolean(account?.charges_enabled && account?.payouts_enabled && account?.details_submitted);
}
__name(connectedAccountReady, "connectedAccountReady");
async function createConnectedAccount(env, input = {}) {
  return stripeRequest(env, "accounts", {
    type: "express",
    country: input.country || "US",
    email: input.email || void 0,
    business_profile: {
      name: input.businessName || void 0,
      product_description: input.productDescription || "Local mobility, rideshare and vehicle rental services"
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    },
    metadata: {
      we_tenant_id: input.tenantId || "",
      we_tenant_slug: input.tenantSlug || ""
    }
  });
}
__name(createConnectedAccount, "createConnectedAccount");
async function retrieveConnectedAccount(env, accountId) {
  return stripeRequest(env, `accounts/${encodeURIComponent(accountId)}`, {}, { method: "GET" });
}
__name(retrieveConnectedAccount, "retrieveConnectedAccount");
async function createAccountLink(env, accountId, input = {}) {
  return stripeRequest(env, "account_links", {
    account: accountId,
    refresh_url: input.refreshUrl,
    return_url: input.returnUrl,
    type: "account_onboarding",
    collection_options: { fields: "eventually_due" }
  });
}
__name(createAccountLink, "createAccountLink");
async function createWhiteLabelSubscriptionCheckout(env, input = {}) {
  return stripeRequest(env, "checkout/sessions", {
    mode: "subscription",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.email || void 0,
    allow_promotion_codes: true,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: 3300,
        recurring: { interval: "month" },
        product_data: {
          name: "Whip Equipped White Label",
          description: "$33/month customer-facing white label with 0% WE transaction fee"
        }
      }
    }],
    subscription_data: {
      metadata: { kind: "we_white_label", tenant_id: input.tenantId, tenant_slug: input.tenantSlug }
    },
    metadata: { kind: "we_white_label", tenant_id: input.tenantId, tenant_slug: input.tenantSlug }
  });
}
__name(createWhiteLabelSubscriptionCheckout, "createWhiteLabelSubscriptionCheckout");
async function createDirectCheckout(env, input = {}) {
  const paymentIntentData = {
    metadata: { kind: input.kind, tenant_id: input.tenantId, resource_id: input.resourceId }
  };
  if (Number(input.applicationFeeCents || 0) > 0) paymentIntentData.application_fee_amount = Math.round(input.applicationFeeCents);
  return stripeRequest(env, "checkout/sessions", {
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.customerEmail || void 0,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: input.currency || "usd",
        unit_amount: Math.round(input.amountCents),
        product_data: { name: input.description || "Whip Equipped mobility service" }
      }
    }],
    payment_intent_data: paymentIntentData,
    metadata: { kind: input.kind, tenant_id: input.tenantId, resource_id: input.resourceId }
  }, { account: input.connectedAccountId });
}
__name(createDirectCheckout, "createDirectCheckout");
async function createManualPaymentIntent(env, input = {}) {
  const params = {
    amount: Math.round(input.amountCents),
    currency: input.currency || "usd",
    capture_method: "manual",
    automatic_payment_methods: { enabled: true },
    description: input.description || "Whip Equipped ride authorization",
    metadata: { kind: input.kind, tenant_id: input.tenantId, resource_id: input.resourceId }
  };
  if (Number(input.applicationFeeCents || 0) > 0) params.application_fee_amount = Math.round(input.applicationFeeCents);
  return stripeRequest(env, "payment_intents", params, { account: input.connectedAccountId });
}
__name(createManualPaymentIntent, "createManualPaymentIntent");
async function capturePaymentIntent(env, paymentIntentId, connectedAccountId, amountCents) {
  return stripeRequest(env, `payment_intents/${encodeURIComponent(paymentIntentId)}/capture`, {
    amount_to_capture: amountCents ? Math.round(amountCents) : void 0
  }, { account: connectedAccountId });
}
__name(capturePaymentIntent, "capturePaymentIntent");
async function cancelPaymentIntent(env, paymentIntentId, connectedAccountId) {
  return stripeRequest(env, `payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`, {}, { account: connectedAccountId });
}
__name(cancelPaymentIntent, "cancelPaymentIntent");
function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hex, "hex");
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result2 = 0;
  for (let i = 0; i < a.length; i++) result2 |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result2 === 0;
}
__name(constantTimeEqual, "constantTimeEqual");
async function matchesSecret(rawBody, timestamp3, signature, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp3}.${rawBody}`));
  return constantTimeEqual(hex(signed), signature);
}
__name(matchesSecret, "matchesSecret");
async function verifyStripeWebhook(rawBody, signatureHeader, secretList, toleranceSeconds = 300) {
  if (!secretList) throw new Error("Stripe webhook secret is not configured");
  if (!signatureHeader) throw new Error("Missing Stripe-Signature header");
  const parts = signatureHeader.split(",");
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  const timestamp3 = Number(timestampPart?.slice(2));
  if (!timestamp3 || !signatures.length) throw new Error("Invalid Stripe signature header");
  if (Math.abs(Math.floor(Date.now() / 1e3) - timestamp3) > toleranceSeconds) throw new Error("Stripe webhook timestamp outside tolerance");
  const secrets = String(secretList).split(",").map((s) => s.trim()).filter(Boolean);
  for (const secret of secrets) {
    for (const signature of signatures) {
      if (await matchesSecret(rawBody, timestamp3, signature, secret)) return JSON.parse(rawBody);
    }
  }
  throw new Error("Invalid Stripe webhook signature");
}
__name(verifyStripeWebhook, "verifyStripeWebhook");

// src/whip/worker.js
var JSON_HEADERS2 = { "content-type": "application/json; charset=utf-8" };
var TRANSITIONS = {
  REQUESTED: ["ACCEPTED", "CANCELED"],
  ACCEPTED: ["DRIVER_EN_ROUTE", "CANCELED"],
  DRIVER_EN_ROUTE: ["DRIVER_ARRIVED", "CANCELED"],
  DRIVER_ARRIVED: ["VERIFIED", "CANCELED"],
  VERIFIED: ["IN_PROGRESS", "CANCELED"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: [],
  CANCELED: []
};
var RENTAL_TRANSITIONS = {
  BOOKED: ["CHECKIN_REQUIRED", "CANCELED"],
  CHECKIN_REQUIRED: ["READY_FOR_PICKUP", "CANCELED"],
  READY_FOR_PICKUP: ["ACTIVE", "CANCELED"],
  ACTIVE: ["RETURN_DUE"],
  RETURN_DUE: ["COMPLETED"],
  COMPLETED: [],
  CANCELED: []
};
function cors(env) {
  return {
    "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-we-user-id,x-we-role",
    "access-control-max-age": "86400"
  };
}
__name(cors, "cors");
function reply2(env, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS2, ...cors(env) } });
}
__name(reply2, "reply");
function fail2(env, message, status = 400, detail) {
  return reply2(env, { error: message, detail }, status);
}
__name(fail2, "fail");
function requiredEnv(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}
__name(requiredEnv, "requiredEnv");
function sbHeaders(env, extra = {}) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", ...extra };
}
__name(sbHeaders, "sbHeaders");
async function sb(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: sbHeaders(env, init.headers || {}) });
  const text2 = await res.text();
  let data = null;
  try {
    data = text2 ? JSON.parse(text2) : null;
  } catch {
    data = text2;
  }
  if (!res.ok) throw new Error(typeof data === "string" ? data : JSON.stringify(data));
  return data;
}
__name(sb, "sb");
async function tenant(env, slug = "whip-equipped") {
  const rows = await sb(env, `tenants?slug=eq.${encodeURIComponent(slug)}&select=*`);
  if (!rows?.length) throw new Error("Tenant not found");
  return rows[0];
}
__name(tenant, "tenant");
async function tenantById(env, id) {
  const rows = await sb(env, `tenants?id=eq.${encodeURIComponent(id)}&select=*`);
  return rows?.[0] || null;
}
__name(tenantById, "tenantById");
async function patchTenant(env, id, patch3) {
  const rows = await sb(env, `tenants?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...patch3, updated_at: (/* @__PURE__ */ new Date()).toISOString() })
  });
  return rows?.[0] || null;
}
__name(patchTenant, "patchTenant");
async function authUser(req, env) {
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: auth } });
    if (res.ok) return res.json();
  }
  if (env.ALLOW_DEMO_IDENTITIES === "true") {
    return { id: req.headers.get("x-we-user-id") || "demo-user", email: "demo@whipequipped.local", demo: true };
  }
  return null;
}
__name(authUser, "authUser");
async function requireUser(req, env) {
  const user4 = await authUser(req, env);
  if (!user4) throw Object.assign(new Error("Authentication required"), { status: 401 });
  return user4;
}
__name(requireUser, "requireUser");
async function requireOperator(req, env, tenantId) {
  const user4 = await requireUser(req, env);
  if (user4.demo && req.headers.get("x-we-role") === "operator") return user4;
  let rows = await sb(env, `operator_members?tenant_id=eq.${encodeURIComponent(tenantId)}&auth_user_id=eq.${encodeURIComponent(user4.id)}&select=*`);
  if (!rows?.length && user4.email) rows = await sb(env, `operator_members?tenant_id=eq.${encodeURIComponent(tenantId)}&email=eq.${encodeURIComponent(user4.email)}&select=*`);
  if (!rows?.length) throw Object.assign(new Error("Operator access required"), { status: 403 });
  return user4;
}
__name(requireOperator, "requireOperator");
function requestIdentity(req, user4, fallback) {
  return user4?.id || req.headers.get("x-we-user-id") || fallback;
}
__name(requestIdentity, "requestIdentity");
function safeSlug(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}
__name(safeSlug, "safeSlug");
function appUrl(env, path = "") {
  return `${String(env.PUBLIC_APP_URL || "https://example.com").replace(/\/$/, "")}${path}`;
}
__name(appUrl, "appUrl");
async function getRide(env, id) {
  const rows = await sb(env, `rides?id=eq.${encodeURIComponent(id)}&select=*`);
  return rows?.[0] || null;
}
__name(getRide, "getRide");
async function patchRide(env, id, patch3) {
  const rows = await sb(env, `rides?id=eq.${encodeURIComponent(id)}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...patch3, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) });
  return rows?.[0] || null;
}
__name(patchRide, "patchRide");
async function getRental(env, id) {
  const rows = await sb(env, `rental_bookings?id=eq.${encodeURIComponent(id)}&select=*`);
  return rows?.[0] || null;
}
__name(getRental, "getRental");
async function patchRental(env, id, patch3) {
  const rows = await sb(env, `rental_bookings?id=eq.${encodeURIComponent(id)}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...patch3, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) });
  return rows?.[0] || null;
}
__name(patchRental, "patchRental");
async function recordPayment(env, payment) {
  const rows = await sb(env, "payments?select=*", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(payment) });
  return rows?.[0] || null;
}
__name(recordPayment, "recordPayment");
async function updatePayments(env, filter, patch3) {
  return sb(env, `payments?${filter}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...patch3, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) });
}
__name(updatePayments, "updatePayments");
async function ensureStripeTenant(env, t) {
  if (!stripeConfigured(env)) throw Object.assign(new Error("Stripe payments are not configured"), { status: 503 });
  if (!t.stripe_account_id) throw Object.assign(new Error("Operator must finish Stripe Connect onboarding before accepting payments"), { status: 409 });
  if (!t.stripe_charges_enabled) {
    const account = await retrieveConnectedAccount(env, t.stripe_account_id);
    const refreshed = await patchTenant(env, t.id, {
      stripe_charges_enabled: Boolean(account.charges_enabled),
      stripe_payouts_enabled: Boolean(account.payouts_enabled),
      stripe_details_submitted: Boolean(account.details_submitted)
    });
    if (!refreshed?.stripe_charges_enabled) throw Object.assign(new Error("Stripe account is not ready to accept charges"), { status: 409 });
    return refreshed;
  }
  return t;
}
__name(ensureStripeTenant, "ensureStripeTenant");
async function processStripeEvent(env, event) {
  const prior = await sb(env, `stripe_events?event_id=eq.${encodeURIComponent(event.id)}&select=event_id`);
  if (prior?.length) return { duplicate: true };
  const object = event.data?.object || {};
  const connectedAccountId = event.account || null;
  if (event.type === "account.updated") {
    const rows = await sb(env, `tenants?stripe_account_id=eq.${encodeURIComponent(object.id)}&select=id`);
    for (const row of rows || []) await patchTenant(env, row.id, {
      stripe_charges_enabled: Boolean(object.charges_enabled),
      stripe_payouts_enabled: Boolean(object.payouts_enabled),
      stripe_details_submitted: Boolean(object.details_submitted)
    });
  }
  if (event.type === "checkout.session.completed") {
    const kind = object.metadata?.kind;
    const tenantId = object.metadata?.tenant_id;
    const resourceId = object.metadata?.resource_id;
    if (kind === "we_white_label" && tenantId) {
      await patchTenant(env, tenantId, {
        stripe_customer_id: typeof object.customer === "string" ? object.customer : null,
        stripe_subscription_id: typeof object.subscription === "string" ? object.subscription : null,
        subscription_status: "active",
        white_label_enabled: true,
        platform_fee_percent: 0
      });
    }
    if (kind === "rental" && resourceId) {
      await patchRental(env, resourceId, {
        payment_status: object.payment_status === "paid" ? "paid" : "processing",
        stripe_checkout_session_id: object.id,
        stripe_payment_intent_id: typeof object.payment_intent === "string" ? object.payment_intent : null
      });
      await updatePayments(env, `stripe_checkout_session_id=eq.${encodeURIComponent(object.id)}`, {
        status: object.payment_status === "paid" ? "paid" : "processing",
        stripe_payment_intent_id: typeof object.payment_intent === "string" ? object.payment_intent : null
      });
    }
  }
  if (event.type === "checkout.session.async_payment_succeeded") {
    const resourceId = object.metadata?.resource_id;
    if (object.metadata?.kind === "rental" && resourceId) await patchRental(env, resourceId, { payment_status: "paid" });
    await updatePayments(env, `stripe_checkout_session_id=eq.${encodeURIComponent(object.id)}`, { status: "paid" });
  }
  if (event.type === "checkout.session.async_payment_failed") {
    const resourceId = object.metadata?.resource_id;
    if (object.metadata?.kind === "rental" && resourceId) await patchRental(env, resourceId, { payment_status: "failed" });
    await updatePayments(env, `stripe_checkout_session_id=eq.${encodeURIComponent(object.id)}`, { status: "failed" });
  }
  if (event.type === "payment_intent.amount_capturable_updated") {
    const resourceId = object.metadata?.resource_id;
    if (object.metadata?.kind === "ride" && resourceId) await patchRide(env, resourceId, { payment_status: "authorized", stripe_payment_intent_id: object.id });
    await updatePayments(env, `stripe_payment_intent_id=eq.${encodeURIComponent(object.id)}`, { status: "authorized" });
  }
  if (event.type === "payment_intent.succeeded") {
    const resourceId = object.metadata?.resource_id;
    if (object.metadata?.kind === "ride" && resourceId) await patchRide(env, resourceId, { payment_status: "paid", stripe_payment_intent_id: object.id });
    if (object.metadata?.kind === "rental" && resourceId) await patchRental(env, resourceId, { payment_status: "paid", stripe_payment_intent_id: object.id });
    await updatePayments(env, `stripe_payment_intent_id=eq.${encodeURIComponent(object.id)}`, { status: "paid" });
  }
  if (event.type === "payment_intent.payment_failed") {
    const resourceId = object.metadata?.resource_id;
    if (object.metadata?.kind === "ride" && resourceId) await patchRide(env, resourceId, { payment_status: "failed" });
    if (object.metadata?.kind === "rental" && resourceId) await patchRental(env, resourceId, { payment_status: "failed" });
    await updatePayments(env, `stripe_payment_intent_id=eq.${encodeURIComponent(object.id)}`, { status: "failed" });
  }
  if (event.type === "payment_intent.canceled") {
    const resourceId = object.metadata?.resource_id;
    if (object.metadata?.kind === "ride" && resourceId) await patchRide(env, resourceId, { payment_status: "canceled" });
    await updatePayments(env, `stripe_payment_intent_id=eq.${encodeURIComponent(object.id)}`, { status: "canceled" });
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const tenantId = object.metadata?.tenant_id;
    if (tenantId) {
      const active = event.type !== "customer.subscription.deleted" && ["active", "trialing"].includes(object.status);
      await patchTenant(env, tenantId, {
        stripe_subscription_id: object.id,
        subscription_status: object.status || (active ? "active" : "canceled"),
        white_label_enabled: active,
        platform_fee_percent: active ? 0 : 0.03
      });
    }
  }
  await sb(env, "stripe_events", { method: "POST", body: JSON.stringify({ event_id: event.id, event_type: event.type, stripe_account_id: connectedAccountId }) });
  return { duplicate: false };
}
__name(processStripeEvent, "processStripeEvent");
var worker_default = {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
    if (!requiredEnv(env)) return fail2(env, "Backend environment is not configured", 503);
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (path === "/api/stripe/webhook" && req.method === "POST") {
        const raw = await req.text();
        const event = await verifyStripeWebhook(raw, req.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
        const result2 = await processStripeEvent(env, event);
        return reply2(env, { received: true, ...result2 });
      }
      if (path === "/health" && req.method === "GET") return reply2(env, {
        ok: true,
        service: "whip-equipped-core",
        version: 3,
        products: ["rider", "driver", "rentals", "operators"],
        payments: stripeConfigured(env) ? "stripe-configured" : "stripe-not-configured"
      });
      if (path === "/api/config" && req.method === "GET") {
        let t;
        const hostname = url.searchParams.get("hostname");
        if (hostname) {
          const domains = await sb(env, `tenant_domains?hostname=eq.${encodeURIComponent(hostname.toLowerCase())}&verified=eq.true&select=tenant_id`);
          t = domains?.[0] ? await tenantById(env, domains[0].tenant_id) : null;
        }
        if (!t) t = await tenant(env, url.searchParams.get("tenant") || "whip-equipped");
        return reply2(env, { tenant: {
          id: t.id,
          slug: t.slug,
          name: t.name,
          logo_url: t.logo_url,
          primary_color: t.primary_color,
          secondary_color: t.secondary_color,
          tagline: t.tagline,
          white_label_enabled: t.white_label_enabled,
          platform_fee_percent: Number(t.platform_fee_percent),
          subscription_status: t.subscription_status
        }, stripe_publishable_key: env.STRIPE_PUBLISHABLE_KEY || null });
      }
      if (path === "/api/operators" && req.method === "POST") {
        const user4 = await requireUser(req, env);
        const body = await req.json();
        const slug = safeSlug(body.slug || body.name);
        if (!body.name || !slug) return fail2(env, "name is required");
        const rows = await sb(env, "tenants?select=*", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
          name: body.name,
          slug,
          contact_email: body.email || user4.email || null,
          primary_color: body.primary_color || "#F04449",
          secondary_color: body.secondary_color || "#F6AD62",
          tagline: body.tagline || "IN THIS TOGETHER",
          white_label_enabled: false,
          platform_fee_percent: 0.03,
          subscription_status: "network"
        }) });
        const t = rows[0];
        await sb(env, "operator_members", { method: "POST", body: JSON.stringify({ tenant_id: t.id, auth_user_id: user4.id, email: body.email || user4.email, role: "owner" }) });
        return reply2(env, { tenant: t }, 201);
      }
      const connectAccountMatch = path.match(/^\/api\/operators\/([^/]+)\/stripe\/account$/);
      if (connectAccountMatch && req.method === "POST") {
        const tenantId = connectAccountMatch[1];
        await requireOperator(req, env, tenantId);
        let t = await tenantById(env, tenantId);
        if (!t) return fail2(env, "Tenant not found", 404);
        if (!stripeConfigured(env)) return fail2(env, "Stripe is not configured", 503);
        if (!t.stripe_account_id) {
          const body = await req.json().catch(() => ({}));
          const account = await createConnectedAccount(env, { tenantId: t.id, tenantSlug: t.slug, email: body.email || t.contact_email, businessName: t.name });
          t = await patchTenant(env, t.id, { stripe_account_id: account.id, stripe_charges_enabled: Boolean(account.charges_enabled), stripe_payouts_enabled: Boolean(account.payouts_enabled), stripe_details_submitted: Boolean(account.details_submitted) });
        }
        return reply2(env, { tenant: t });
      }
      const onboardingMatch = path.match(/^\/api\/operators\/([^/]+)\/stripe\/onboarding-link$/);
      if (onboardingMatch && req.method === "POST") {
        const tenantId = onboardingMatch[1];
        await requireOperator(req, env, tenantId);
        const t = await tenantById(env, tenantId);
        if (!t?.stripe_account_id) return fail2(env, "Create the connected account first", 409);
        const body = await req.json().catch(() => ({}));
        const link = await createAccountLink(env, t.stripe_account_id, {
          returnUrl: body.return_url || appUrl(env, `/operator.html?tenant=${encodeURIComponent(t.id)}&stripe=return`),
          refreshUrl: body.refresh_url || appUrl(env, `/operator.html?tenant=${encodeURIComponent(t.id)}&stripe=refresh`)
        });
        return reply2(env, { url: link.url, expires_at: link.expires_at });
      }
      const connectStatusMatch = path.match(/^\/api\/operators\/([^/]+)\/stripe\/status$/);
      if (connectStatusMatch && req.method === "GET") {
        const tenantId = connectStatusMatch[1];
        await requireOperator(req, env, tenantId);
        const t = await tenantById(env, tenantId);
        if (!t?.stripe_account_id) return reply2(env, { connected: false, ready: false });
        const account = await retrieveConnectedAccount(env, t.stripe_account_id);
        const updated = await patchTenant(env, t.id, { stripe_charges_enabled: Boolean(account.charges_enabled), stripe_payouts_enabled: Boolean(account.payouts_enabled), stripe_details_submitted: Boolean(account.details_submitted) });
        return reply2(env, { connected: true, ready: connectedAccountReady(account), account_id: account.id, charges_enabled: account.charges_enabled, payouts_enabled: account.payouts_enabled, details_submitted: account.details_submitted, tenant: updated });
      }
      const whiteLabelMatch = path.match(/^\/api\/operators\/([^/]+)\/white-label\/checkout$/);
      if (whiteLabelMatch && req.method === "POST") {
        const tenantId = whiteLabelMatch[1];
        await requireOperator(req, env, tenantId);
        const t = await tenantById(env, tenantId);
        if (!t) return fail2(env, "Tenant not found", 404);
        const body = await req.json().catch(() => ({}));
        const session = await createWhiteLabelSubscriptionCheckout(env, {
          tenantId: t.id,
          tenantSlug: t.slug,
          email: t.contact_email,
          successUrl: body.success_url || appUrl(env, `/operator.html?tenant=${encodeURIComponent(t.id)}&white_label=success`),
          cancelUrl: body.cancel_url || appUrl(env, `/operator.html?tenant=${encodeURIComponent(t.id)}&white_label=cancel`)
        });
        await recordPayment(env, { tenant_id: t.id, resource_type: "white_label_subscription", resource_id: t.id, stripe_checkout_session_id: session.id, amount_cents: 3300, application_fee_cents: 0, status: "checkout_created" });
        return reply2(env, { checkout_url: session.url, session_id: session.id });
      }
      const operatorDashboard = path.match(/^\/api\/operators\/([^/]+)\/dashboard$/);
      if (operatorDashboard && req.method === "GET") {
        const tenantId = operatorDashboard[1];
        await requireOperator(req, env, tenantId);
        const t = await tenantById(env, tenantId);
        if (!t) return fail2(env, "Tenant not found", 404);
        const [rides, rentals, vehicles, payments] = await Promise.all([
          sb(env, `rides?tenant_id=eq.${t.id}&select=id,status,fare_cents,requested_at&order=requested_at.desc&limit=25`),
          sb(env, `rental_bookings?tenant_id=eq.${t.id}&select=id,status,total_cents,payment_status,created_at&order=created_at.desc&limit=25`),
          sb(env, `rental_vehicles?tenant_id=eq.${t.id}&select=*`),
          sb(env, `payments?tenant_id=eq.${t.id}&select=*&order=created_at.desc&limit=50`)
        ]);
        return reply2(env, { tenant: t, rides, rentals, vehicles, payments });
      }
      if (path === "/api/partners" && req.method === "GET") {
        const category = url.searchParams.get("category");
        const enabled = url.searchParams.get("include_candidates") === "1" ? "" : "&enabled=eq.true";
        const filter = category ? `&category=eq.${encodeURIComponent(category)}` : "";
        const rows = await sb(env, `partner_catalog?select=*${enabled}${filter}&order=name.asc`);
        return reply2(env, { partners: rows || [] });
      }
      const partnerReferral = path.match(/^\/api\/partners\/([^/]+)\/referrals$/);
      if (partnerReferral && req.method === "POST") {
        const user4 = await requireUser(req, env);
        const body = await req.json();
        const partners = await sb(env, `partner_catalog?slug=eq.${encodeURIComponent(partnerReferral[1])}&enabled=eq.true&select=*`);
        const partner = partners?.[0];
        if (!partner) return fail2(env, "Partner is not live", 404);
        const t = await tenant(env, body.tenant_slug || "whip-equipped");
        const rows = await sb(env, "partner_referrals?select=*", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ partner_id: partner.id, tenant_id: t.id, customer_id: user4.id, resource_type: body.resource_type || null, resource_id: body.resource_id || null, source: body.source || "app", metadata: body.metadata || {} }) });
        return reply2(env, { referral: rows[0], partner }, 201);
      }
      if (path === "/api/rides" && req.method === "POST") {
        const user4 = await requireUser(req, env);
        const body = await req.json();
        const t = await tenant(env, body.tenant_slug || "whip-equipped");
        const fare = Math.max(0, Number(body.fare_cents || 0));
        const platformFee = t.white_label_enabled ? 0 : Math.round(fare * Number(t.platform_fee_percent || 0.03));
        const ride3 = { tenant_id: t.id, rider_id: requestIdentity(req, user4, "demo-rider"), rider_name: body.rider_name || user4.user_metadata?.full_name || "Rider", status: "REQUESTED", pickup_label: body.pickup_label || "Current location", pickup_lat: body.pickup_lat ?? null, pickup_lng: body.pickup_lng ?? null, dropoff_label: body.dropoff_label, dropoff_lat: body.dropoff_lat ?? null, dropoff_lng: body.dropoff_lng ?? null, miles: body.miles ?? null, minutes: body.minutes ?? null, ride_tier: body.ride_tier || "WE Standard", fare_cents: fare, platform_fee_cents: platformFee, pickup_pin: String(Math.floor(1e3 + Math.random() * 9e3)), payment_status: "unpaid" };
        if (!ride3.dropoff_label || !fare) return fail2(env, "dropoff_label and fare_cents are required");
        const rows = await sb(env, "rides?select=*", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(ride3) });
        return reply2(env, { ride: rows[0] }, 201);
      }
      const rideMatch = path.match(/^\/api\/rides\/([^/]+)$/);
      if (rideMatch && req.method === "GET") {
        await requireUser(req, env);
        const ride3 = await getRide(env, rideMatch[1]);
        return ride3 ? reply2(env, { ride: ride3 }) : fail2(env, "Ride not found", 404);
      }
      const ridePaymentMatch = path.match(/^\/api\/rides\/([^/]+)\/payment-intent$/);
      if (ridePaymentMatch && req.method === "POST") {
        await requireUser(req, env);
        const ride3 = await getRide(env, ridePaymentMatch[1]);
        if (!ride3) return fail2(env, "Ride not found", 404);
        let t = await tenantById(env, ride3.tenant_id);
        t = await ensureStripeTenant(env, t);
        if (ride3.stripe_payment_intent_id) return reply2(env, { payment_intent_id: ride3.stripe_payment_intent_id, connected_account_id: t.stripe_account_id, publishable_key: env.STRIPE_PUBLISHABLE_KEY || null, status: ride3.payment_status });
        const intent = await createManualPaymentIntent(env, { amountCents: ride3.fare_cents, applicationFeeCents: ride3.platform_fee_cents, connectedAccountId: t.stripe_account_id, kind: "ride", tenantId: t.id, resourceId: ride3.id, description: `${ride3.ride_tier}: ${ride3.pickup_label} to ${ride3.dropoff_label}` });
        await recordPayment(env, { tenant_id: t.id, resource_type: "ride", resource_id: ride3.id, connected_account_id: t.stripe_account_id, stripe_payment_intent_id: intent.id, amount_cents: ride3.fare_cents, application_fee_cents: ride3.platform_fee_cents, status: intent.status });
        await patchRide(env, ride3.id, { stripe_payment_intent_id: intent.id, payment_status: intent.status });
        return reply2(env, { payment_intent_id: intent.id, client_secret: intent.client_secret, connected_account_id: t.stripe_account_id, publishable_key: env.STRIPE_PUBLISHABLE_KEY || null, status: intent.status });
      }
      if (path === "/api/offers" && req.method === "GET") {
        const rows = await sb(env, "rides?status=eq.REQUESTED&payment_status=in.(authorized,paid,unpaid)&order=requested_at.asc&limit=20&select=*");
        return reply2(env, { offers: rows || [] });
      }
      const acceptMatch = path.match(/^\/api\/rides\/([^/]+)\/accept$/);
      if (acceptMatch && req.method === "POST") {
        const body = await req.json(), current = await getRide(env, acceptMatch[1]);
        if (!current) return fail2(env, "Ride not found", 404);
        if (current.status !== "REQUESTED") return fail2(env, "Ride is no longer available", 409);
        if (!body.driver_id) return fail2(env, "driver_id is required");
        const drivers = await sb(env, `drivers?id=eq.${encodeURIComponent(body.driver_id)}&select=*`), driver2 = drivers?.[0];
        if (!driver2) return fail2(env, "Driver not found", 404);
        const ride3 = await patchRide(env, current.id, { status: "ACCEPTED", driver_id: driver2.id, accepted_at: (/* @__PURE__ */ new Date()).toISOString(), driver_name: driver2.display_name, driver_vehicle: [driver2.vehicle_color, driver2.vehicle_make, driver2.vehicle_model].filter(Boolean).join(" "), driver_plate: driver2.license_plate, driver_rating: driver2.rating });
        return reply2(env, { ride: ride3 });
      }
      const statusMatch = path.match(/^\/api\/rides\/([^/]+)\/status$/);
      if (statusMatch && req.method === "PATCH") {
        const body = await req.json(), current = await getRide(env, statusMatch[1]);
        if (!current) return fail2(env, "Ride not found", 404);
        const next = String(body.status || "").toUpperCase();
        if (!TRANSITIONS[current.status]?.includes(next)) return fail2(env, `Illegal transition ${current.status} -> ${next}`, 409);
        if (current.driver_id && body.driver_id && current.driver_id !== body.driver_id) return fail2(env, "Ride belongs to another driver", 403);
        const t = await tenantById(env, current.tenant_id);
        if (next === "COMPLETED" && current.stripe_payment_intent_id) {
          if (current.payment_status !== "authorized") return fail2(env, "Ride payment is not authorized for capture", 402);
          await capturePaymentIntent(env, current.stripe_payment_intent_id, t.stripe_account_id, current.fare_cents);
        }
        if (next === "CANCELED" && current.stripe_payment_intent_id && !["paid", "canceled"].includes(current.payment_status)) {
          await cancelPaymentIntent(env, current.stripe_payment_intent_id, t.stripe_account_id);
        }
        const timestamps = {};
        if (next === "DRIVER_ARRIVED") timestamps.arrived_at = (/* @__PURE__ */ new Date()).toISOString();
        if (next === "IN_PROGRESS") timestamps.started_at = (/* @__PURE__ */ new Date()).toISOString();
        if (next === "COMPLETED") timestamps.completed_at = (/* @__PURE__ */ new Date()).toISOString();
        return reply2(env, { ride: await patchRide(env, current.id, { status: next, ...timestamps }) });
      }
      const presenceMatch = path.match(/^\/api\/drivers\/([^/]+)\/presence$/);
      if (presenceMatch && req.method === "PATCH") {
        const body = await req.json(), rows = await sb(env, `drivers?id=eq.${encodeURIComponent(presenceMatch[1])}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ online: Boolean(body.online), lat: body.lat ?? null, lng: body.lng ?? null, heading: body.heading ?? null, last_seen_at: (/* @__PURE__ */ new Date()).toISOString() }) });
        return reply2(env, { driver: rows?.[0] || null });
      }
      const activeDriver = path.match(/^\/api\/drivers\/([^/]+)\/active$/);
      if (activeDriver && req.method === "GET") {
        const rows = await sb(env, `rides?driver_id=eq.${encodeURIComponent(activeDriver[1])}&status=not.in.(COMPLETED,CANCELED)&order=requested_at.desc&limit=1&select=*`);
        return reply2(env, { ride: rows?.[0] || null });
      }
      const activeRider = path.match(/^\/api\/riders\/([^/]+)\/active$/);
      if (activeRider && req.method === "GET") {
        const rows = await sb(env, `rides?rider_id=eq.${encodeURIComponent(activeRider[1])}&status=not.in.(COMPLETED,CANCELED)&order=requested_at.desc&limit=1&select=*`);
        return reply2(env, { ride: rows?.[0] || null });
      }
      if (path === "/api/rentals/vehicles" && req.method === "GET") {
        const t = await tenant(env, url.searchParams.get("tenant") || "whip-equipped");
        const category = url.searchParams.get("category");
        const filter = category && category !== "all" ? `&category=eq.${encodeURIComponent(category)}` : "";
        const rows = await sb(env, `rental_vehicles?tenant_id=eq.${t.id}&available=eq.true${filter}&order=daily_rate_cents.asc&select=*`);
        return reply2(env, { vehicles: rows || [] });
      }
      if (path === "/api/rentals/bookings" && req.method === "POST") {
        const user4 = await requireUser(req, env);
        const body = await req.json(), t = await tenant(env, body.tenant_slug || "whip-equipped");
        const vehicleRows = await sb(env, `rental_vehicles?id=eq.${encodeURIComponent(body.vehicle_id || "")}&tenant_id=eq.${t.id}&available=eq.true&select=*`), vehicle = vehicleRows?.[0];
        if (!vehicle) return fail2(env, "Rental vehicle not found or unavailable", 404);
        const days = Math.max(1, Number(body.rental_days || 1)), daily = Number(vehicle.daily_rate_cents), extras = Math.max(0, Number(body.extras_cents || 0)), protection = Math.max(0, Number(body.protection_cents || 0)), tax = Math.max(0, Number(body.tax_cents || 0));
        const subtotal = daily * days + extras + protection, total = subtotal + tax, platform = t.white_label_enabled ? 0 : Math.round(total * Number(t.platform_fee_percent || 0.03));
        const booking = { tenant_id: t.id, vehicle_id: vehicle.id, renter_id: requestIdentity(req, user4, "demo-renter"), status: "CHECKIN_REQUIRED", start_at: body.start_at, end_at: body.end_at, pickup_label: body.pickup_label || vehicle.location_label, rental_days: days, daily_rate_cents: daily, extras_cents: extras, protection_cents: protection, tax_cents: tax, platform_fee_cents: platform, total_cents: total, payment_status: "unpaid" };
        if (!booking.start_at || !booking.end_at) return fail2(env, "start_at and end_at are required");
        const rows = await sb(env, "rental_bookings?select=*", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(booking) });
        return reply2(env, { booking: rows[0], vehicle }, 201);
      }
      const rentalMatch = path.match(/^\/api\/rentals\/bookings\/([^/]+)$/);
      if (rentalMatch && req.method === "GET") {
        await requireUser(req, env);
        const booking = await getRental(env, rentalMatch[1]);
        if (!booking) return fail2(env, "Rental booking not found", 404);
        const vehicleRows = await sb(env, `rental_vehicles?id=eq.${encodeURIComponent(booking.vehicle_id)}&select=*`);
        return reply2(env, { booking, vehicle: vehicleRows?.[0] || null });
      }
      const rentalCheckout = path.match(/^\/api\/rentals\/bookings\/([^/]+)\/checkout$/);
      if (rentalCheckout && req.method === "POST") {
        const user4 = await requireUser(req, env);
        const booking = await getRental(env, rentalCheckout[1]);
        if (!booking) return fail2(env, "Rental booking not found", 404);
        let t = await tenantById(env, booking.tenant_id);
        t = await ensureStripeTenant(env, t);
        const vehicleRows = await sb(env, `rental_vehicles?id=eq.${encodeURIComponent(booking.vehicle_id)}&select=*`);
        const vehicle = vehicleRows?.[0];
        const body = await req.json().catch(() => ({}));
        const session = await createDirectCheckout(env, {
          amountCents: booking.total_cents,
          applicationFeeCents: booking.platform_fee_cents,
          connectedAccountId: t.stripe_account_id,
          kind: "rental",
          tenantId: t.id,
          resourceId: booking.id,
          description: `${vehicle?.name || "Vehicle"} rental`,
          customerEmail: user4.email,
          successUrl: body.success_url || appUrl(env, `/?rental_payment=success&booking_id=${encodeURIComponent(booking.id)}`),
          cancelUrl: body.cancel_url || appUrl(env, `/?rental_payment=cancel&booking_id=${encodeURIComponent(booking.id)}`)
        });
        await recordPayment(env, { tenant_id: t.id, resource_type: "rental", resource_id: booking.id, connected_account_id: t.stripe_account_id, stripe_checkout_session_id: session.id, amount_cents: booking.total_cents, application_fee_cents: booking.platform_fee_cents, status: "checkout_created" });
        await patchRental(env, booking.id, { stripe_checkout_session_id: session.id, payment_status: "checkout_created" });
        return reply2(env, { checkout_url: session.url, session_id: session.id, amount_cents: booking.total_cents });
      }
      const rentalStatus = path.match(/^\/api\/rentals\/bookings\/([^/]+)\/status$/);
      if (rentalStatus && req.method === "PATCH") {
        const body = await req.json(), current = await getRental(env, rentalStatus[1]);
        if (!current) return fail2(env, "Rental booking not found", 404);
        const next = String(body.status || "").toUpperCase();
        if (!RENTAL_TRANSITIONS[current.status]?.includes(next)) return fail2(env, `Illegal rental transition ${current.status} -> ${next}`, 409);
        if (next === "ACTIVE" && current.payment_status !== "paid") return fail2(env, "Rental payment must be completed before pickup", 402);
        const patch3 = { status: next };
        if (next === "ACTIVE") patch3.activated_at = (/* @__PURE__ */ new Date()).toISOString();
        if (next === "COMPLETED") patch3.completed_at = (/* @__PURE__ */ new Date()).toISOString();
        return reply2(env, { booking: await patchRental(env, current.id, patch3) });
      }
      const rentalCheckin = path.match(/^\/api\/rentals\/bookings\/([^/]+)\/checkin$/);
      if (rentalCheckin && req.method === "PATCH") {
        const body = await req.json(), current = await getRental(env, rentalCheckin[1]);
        if (!current) return fail2(env, "Rental booking not found", 404);
        if (!["CHECKIN_REQUIRED", "READY_FOR_PICKUP"].includes(current.status)) return fail2(env, "Check-in is closed for this rental", 409);
        const allowed = ["license_verified", "pretrip_photos_complete", "pickup_instructions_seen"];
        const patch3 = {};
        for (const key of allowed) if (key in body) patch3[key] = Boolean(body[key]);
        const merged = { ...current, ...patch3 };
        if (merged.license_verified && merged.pretrip_photos_complete && merged.pickup_instructions_seen) patch3.status = "READY_FOR_PICKUP";
        return reply2(env, { booking: await patchRental(env, current.id, patch3) });
      }
      const rentalReturn = path.match(/^\/api\/rentals\/bookings\/([^/]+)\/return$/);
      if (rentalReturn && req.method === "PATCH") {
        const body = await req.json(), current = await getRental(env, rentalReturn[1]);
        if (!current) return fail2(env, "Rental booking not found", 404);
        if (current.status !== "RETURN_DUE") return fail2(env, "Rental is not in return workflow", 409);
        return reply2(env, { booking: await patchRental(env, current.id, { return_photos_complete: Boolean(body.return_photos_complete), fuel_return_confirmed: Boolean(body.fuel_return_confirmed) }) });
      }
      const renterRentals = path.match(/^\/api\/renters\/([^/]+)\/rentals$/);
      if (renterRentals && req.method === "GET") {
        const rows = await sb(env, `rental_bookings?renter_id=eq.${encodeURIComponent(renterRentals[1])}&order=created_at.desc&limit=50&select=*`);
        return reply2(env, { bookings: rows || [] });
      }
      return fail2(env, "Not found", 404);
    } catch (error) {
      return fail2(env, error.message || "Backend request failed", error.status || 500, error.stripe || void 0);
    }
  }
};

// src/whip/router.js
var JSON_HEADERS3 = { "content-type": "application/json; charset=utf-8" };
function cors2(env) {
  return { "access-control-allow-origin": env.ALLOWED_ORIGIN || "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", "access-control-allow-headers": "content-type,authorization,x-we-user-id,x-we-role", "access-control-max-age": "86400" };
}
__name(cors2, "cors");
function reply3(env, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS3, ...cors2(env) } });
}
__name(reply3, "reply");
function fail3(env, message, status = 400, detail) {
  return reply3(env, { error: message, detail }, status);
}
__name(fail3, "fail");
function sbHeaders2(env, extra = {}) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", ...extra };
}
__name(sbHeaders2, "sbHeaders");
async function sb2(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: sbHeaders2(env, init.headers || {}) });
  const text2 = await res.text();
  let data = null;
  try {
    data = text2 ? JSON.parse(text2) : null;
  } catch {
    data = text2;
  }
  if (!res.ok) throw Object.assign(new Error(typeof data === "string" ? data : JSON.stringify(data)), { status: res.status });
  return data;
}
__name(sb2, "sb");
async function supabaseAuth(env, path, body, authorization) {
  const headers7 = { "content-type": "application/json", apikey: env.SUPABASE_SERVICE_ROLE_KEY };
  if (authorization) headers7.authorization = authorization;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/${path}`, { method: "POST", headers: headers7, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.msg || data.message || data.error_description || data.error || "Authentication failed"), { status: res.status });
  return data;
}
__name(supabaseAuth, "supabaseAuth");
async function userFromRequest(req, env) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: auth } });
  if (!res.ok) return null;
  return res.json();
}
__name(userFromRequest, "userFromRequest");
async function requireUser2(req, env) {
  const user4 = await userFromRequest(req, env);
  if (!user4) throw Object.assign(new Error("Authentication required"), { status: 401 });
  return user4;
}
__name(requireUser2, "requireUser");
async function requireOperator2(req, env, tenantId) {
  const user4 = await requireUser2(req, env);
  const rows = await sb2(env, `operator_members?tenant_id=eq.${encodeURIComponent(tenantId)}&auth_user_id=eq.${encodeURIComponent(user4.id)}&select=*`);
  if (!rows?.length) throw Object.assign(new Error("Operator access required"), { status: 403 });
  return { user: user4, membership: rows[0] };
}
__name(requireOperator2, "requireOperator");
function cleanSlug(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}
__name(cleanSlug, "cleanSlug");
function vehicleId(tenantId, name) {
  return `${tenantId.slice(0, 8)}-${cleanSlug(name)}-${crypto.randomUUID().slice(0, 8)}`;
}
__name(vehicleId, "vehicleId");
var router_default = { async fetch(req, env, ctx) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors2(env) });
  const url = new URL(req.url), path = url.pathname.replace(/\/+$/, "") || "/";
  try {
    if (path === "/api/auth/signup" && req.method === "POST") {
      const body = await req.json();
      if (!body.email || !body.password || String(body.password).length < 8) return fail3(env, "Email and a password of at least 8 characters are required");
      const data = await supabaseAuth(env, "signup", { email: String(body.email).trim().toLowerCase(), password: body.password });
      return reply3(env, data, 201);
    }
    if (path === "/api/auth/login" && req.method === "POST") {
      const body = await req.json();
      const data = await supabaseAuth(env, "token?grant_type=password", { email: String(body.email || "").trim().toLowerCase(), password: body.password });
      return reply3(env, data);
    }
    if (path === "/api/auth/refresh" && req.method === "POST") {
      const body = await req.json();
      const data = await supabaseAuth(env, "token?grant_type=refresh_token", { refresh_token: body.refresh_token });
      return reply3(env, data);
    }
    if (path === "/api/auth/logout" && req.method === "POST") {
      await supabaseAuth(env, "logout", {}, req.headers.get("authorization"));
      return reply3(env, { ok: true });
    }
    if (path === "/api/auth/me" && req.method === "GET") {
      const user4 = await requireUser2(req, env);
      return reply3(env, { user: user4 });
    }
    if (path === "/api/operators/mine" && req.method === "GET") {
      const user4 = await requireUser2(req, env);
      const memberships = await sb2(env, `operator_members?auth_user_id=eq.${encodeURIComponent(user4.id)}&select=tenant_id,role,email`);
      const ids = [...new Set((memberships || []).map((x) => x.tenant_id))];
      const tenants = [];
      for (const id of ids) {
        const rows = await sb2(env, `tenants?id=eq.${encodeURIComponent(id)}&select=*`);
        if (rows?.[0]) tenants.push({ ...rows[0], role: memberships.find((m) => m.tenant_id === id)?.role || "viewer" });
      }
      return reply3(env, { tenants });
    }
    const brandMatch = path.match(/^\/api\/operators\/([^/]+)\/brand$/);
    if (brandMatch && req.method === "PATCH") {
      const tenantId = brandMatch[1];
      await requireOperator2(req, env, tenantId);
      const body = await req.json();
      const patch3 = { updated_at: (/* @__PURE__ */ new Date()).toISOString() };
      if (body.name) patch3.name = String(body.name).trim().slice(0, 80);
      if (body.logo_url !== void 0) patch3.logo_url = body.logo_url || null;
      if (/^#[0-9a-f]{6}$/i.test(body.primary_color || "")) patch3.primary_color = body.primary_color;
      if (/^#[0-9a-f]{6}$/i.test(body.secondary_color || "")) patch3.secondary_color = body.secondary_color;
      if (body.tagline) patch3.tagline = String(body.tagline).trim().slice(0, 100);
      const rows = await sb2(env, `tenants?id=eq.${encodeURIComponent(tenantId)}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch3) });
      return reply3(env, { tenant: rows?.[0] || null });
    }
    const vehiclesMatch = path.match(/^\/api\/operators\/([^/]+)\/vehicles$/);
    if (vehiclesMatch && req.method === "GET") {
      const tenantId = vehiclesMatch[1];
      await requireOperator2(req, env, tenantId);
      const rows = await sb2(env, `rental_vehicles?tenant_id=eq.${encodeURIComponent(tenantId)}&order=created_at.desc&select=*`);
      return reply3(env, { vehicles: rows || [] });
    }
    if (vehiclesMatch && req.method === "POST") {
      const tenantId = vehiclesMatch[1];
      await requireOperator2(req, env, tenantId);
      const body = await req.json();
      if (!body.name || !body.daily_rate_cents) return fail3(env, "Vehicle name and daily_rate_cents are required");
      const tenantRows = await sb2(env, `tenants?id=eq.${encodeURIComponent(tenantId)}&select=name`);
      if (!tenantRows?.length) return fail3(env, "Tenant not found", 404);
      const row = { id: vehicleId(tenantId, body.name), tenant_id: tenantId, name: String(body.name).trim(), category: body.category || "economy", operator_name: tenantRows[0].name, location_label: body.location_label || "Operator location", daily_rate_cents: Math.max(1, Math.round(Number(body.daily_rate_cents))), rating: 5, rental_count: 0, seats: Math.max(1, Number(body.seats || 5)), transmission: body.transmission || "Automatic", fuel_type: body.fuel_type || "Gas", color_hex: /^#[0-9a-f]{6}$/i.test(body.color_hex || "") ? body.color_hex : "#222222", mileage_per_day: Math.max(1, Number(body.mileage_per_day || 200)), available: body.available !== false };
      const rows = await sb2(env, "rental_vehicles?select=*", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
      return reply3(env, { vehicle: rows[0] }, 201);
    }
    const vehicleMatch = path.match(/^\/api\/operators\/([^/]+)\/vehicles\/([^/]+)$/);
    if (vehicleMatch && req.method === "PATCH") {
      const [_, tenantId, id] = vehicleMatch;
      await requireOperator2(req, env, tenantId);
      const body = await req.json();
      const allowed = ["name", "category", "location_label", "daily_rate_cents", "seats", "transmission", "fuel_type", "color_hex", "mileage_per_day", "available"];
      const patch3 = { updated_at: (/* @__PURE__ */ new Date()).toISOString() };
      for (const key of allowed) if (key in body) patch3[key] = body[key];
      const rows = await sb2(env, `rental_vehicles?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${encodeURIComponent(tenantId)}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch3) });
      if (!rows?.length) return fail3(env, "Vehicle not found", 404);
      return reply3(env, { vehicle: rows[0] });
    }
    if (path === "/api/sales/leads" && req.method === "POST") {
      await requireUser2(req, env);
      const body = await req.json();
      if (!body.company_name) return fail3(env, "company_name is required");
      const rows = await sb2(env, "sales_leads?select=*", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ company_name: body.company_name, market: body.market || null, website: body.website || null, email: body.email || null, phone: body.phone || null, fleet_note: body.fleet_note || null, app_gap_note: body.app_gap_note || null, source_url: body.source_url || null, status: body.status || "prospect" }) });
      return reply3(env, { lead: rows[0] }, 201);
    }
    const response = await worker_default.fetch(req, env, ctx);
    const headers7 = new Headers(response.headers);
    Object.entries(cors2(env)).forEach(([k, v]) => headers7.set(k, v));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: headers7 });
  } catch (error) {
    return fail3(env, error.message || "Request failed", error.status || 500);
  }
} };

// src/whip/gateway.js
var JSON_HEADERS4 = { "content-type": "application/json; charset=utf-8" };
var DRIVER_TRANSITIONS = /* @__PURE__ */ new Set(["DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "VERIFIED", "IN_PROGRESS", "COMPLETED"]);
function cors3(env) {
  return { "access-control-allow-origin": env.ALLOWED_ORIGIN || "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", "access-control-allow-headers": "content-type,authorization,x-we-user-id,x-we-role", "access-control-max-age": "86400" };
}
__name(cors3, "cors");
function reply4(env, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS4, ...cors3(env) } });
}
__name(reply4, "reply");
function fail4(env, message, status = 400) {
  return reply4(env, { error: message }, status);
}
__name(fail4, "fail");
function sbHeaders3(env, extra = {}) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", ...extra };
}
__name(sbHeaders3, "sbHeaders");
async function sb3(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: sbHeaders3(env, init.headers || {}) });
  const text2 = await res.text();
  let data = null;
  try {
    data = text2 ? JSON.parse(text2) : null;
  } catch {
    data = text2;
  }
  if (!res.ok) throw Object.assign(new Error(typeof data === "string" ? data : JSON.stringify(data)), { status: res.status });
  return data;
}
__name(sb3, "sb");
async function user(req, env) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: auth } });
  return res.ok ? res.json() : null;
}
__name(user, "user");
async function requireUser3(req, env) {
  const u = await user(req, env);
  if (!u) throw Object.assign(new Error("Authentication required"), { status: 401 });
  return u;
}
__name(requireUser3, "requireUser");
async function driverForUser(req, env) {
  const u = await requireUser3(req, env);
  const rows = await sb3(env, `drivers?auth_user_id=eq.${encodeURIComponent(u.id)}&select=*`);
  return { user: u, driver: rows?.[0] || null };
}
__name(driverForUser, "driverForUser");
async function requireDriver(req, env) {
  const x = await driverForUser(req, env);
  if (!x.driver) throw Object.assign(new Error("Driver profile required"), { status: 409 });
  return x;
}
__name(requireDriver, "requireDriver");
async function ride(env, id) {
  const rows = await sb3(env, `rides?id=eq.${encodeURIComponent(id)}&select=*`);
  return rows?.[0] || null;
}
__name(ride, "ride");
async function tenant2(env, slug) {
  const rows = await sb3(env, `tenants?slug=eq.${encodeURIComponent(slug)}&select=*`);
  return rows?.[0] || null;
}
__name(tenant2, "tenant");
var gateway_default = { async fetch(req, env, ctx) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors3(env) });
  const url = new URL(req.url), path = url.pathname.replace(/\/+$/, "") || "/";
  try {
    if (path === "/api/drivers/me" && req.method === "GET") {
      const x = await driverForUser(req, env);
      return reply4(env, { driver: x.driver, user: { id: x.user.id, email: x.user.email } });
    }
    if (path === "/api/drivers/me" && req.method === "POST") {
      const u = await requireUser3(req, env);
      const existing = await sb3(env, `drivers?auth_user_id=eq.${encodeURIComponent(u.id)}&select=*`);
      if (existing?.length) return reply4(env, { driver: existing[0] });
      const body = await req.json(), t = await tenant2(env, body.tenant_slug || "whip-equipped");
      if (!t) return fail4(env, "Tenant not found", 404);
      if (!body.display_name || !body.license_plate) return fail4(env, "display_name and license_plate are required");
      const rows = await sb3(env, "drivers?select=*", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ tenant_id: t.id, auth_user_id: u.id, display_name: String(body.display_name).trim(), phone: body.phone || null, rating: 5, vehicle_make: body.vehicle_make || null, vehicle_model: body.vehicle_model || null, vehicle_color: body.vehicle_color || null, license_plate: String(body.license_plate).trim().toUpperCase(), seats: Number(body.seats || 4), online: false }) });
      return reply4(env, { driver: rows[0] }, 201);
    }
    if (path === "/api/offers" && req.method === "GET") {
      const { driver: driver2 } = await requireDriver(req, env);
      if (!driver2.online) return reply4(env, { offers: [] });
      const rows = await sb3(env, `rides?tenant_id=eq.${encodeURIComponent(driver2.tenant_id)}&status=eq.REQUESTED&payment_status=in.(authorized,paid)&order=requested_at.asc&limit=20&select=*`);
      return reply4(env, { offers: rows || [] });
    }
    const presence = path.match(/^\/api\/drivers\/([^/]+)\/presence$/);
    if (presence && req.method === "PATCH") {
      const { driver: driver2 } = await requireDriver(req, env);
      if (driver2.id !== presence[1]) return fail4(env, "Cannot modify another driver", 403);
      return router_default.fetch(req, env, ctx);
    }
    const active = path.match(/^\/api\/drivers\/([^/]+)\/active$/);
    if (active && req.method === "GET") {
      const { driver: driver2 } = await requireDriver(req, env);
      if (driver2.id !== active[1]) return fail4(env, "Cannot view another driver", 403);
      return router_default.fetch(req, env, ctx);
    }
    const accept = path.match(/^\/api\/rides\/([^/]+)\/accept$/);
    if (accept && req.method === "POST") {
      const { driver: driver2 } = await requireDriver(req, env), r = await ride(env, accept[1]);
      if (!r) return fail4(env, "Ride not found", 404);
      if (r.tenant_id !== driver2.tenant_id) return fail4(env, "Ride belongs to another operator", 403);
      if (r.status !== "REQUESTED") return fail4(env, "Ride is no longer available", 409);
      if (!["authorized", "paid"].includes(r.payment_status)) return fail4(env, "Ride payment is not authorized", 402);
      const headers7 = new Headers(req.headers);
      headers7.set("content-type", "application/json");
      const forwarded = new Request(req.url, { method: "POST", headers: headers7, body: JSON.stringify({ driver_id: driver2.id }) });
      return router_default.fetch(forwarded, env, ctx);
    }
    const rideStatus = path.match(/^\/api\/rides\/([^/]+)\/status$/);
    if (rideStatus && req.method === "PATCH") {
      const copy = req.clone(), body = await copy.json(), next = String(body.status || "").toUpperCase(), r = await ride(env, rideStatus[1]);
      if (!r) return fail4(env, "Ride not found", 404);
      const u = await requireUser3(req, env);
      if (DRIVER_TRANSITIONS.has(next)) {
        const rows = await sb3(env, `drivers?auth_user_id=eq.${encodeURIComponent(u.id)}&select=*`), d = rows?.[0];
        if (!d || r.driver_id !== d.id) return fail4(env, "This ride is not assigned to your driver account", 403);
        const headers7 = new Headers(req.headers);
        headers7.set("content-type", "application/json");
        const forwarded = new Request(req.url, { method: "PATCH", headers: headers7, body: JSON.stringify({ ...body, driver_id: d.id }) });
        return router_default.fetch(forwarded, env, ctx);
      }
      if (next === "CANCELED") {
        if (r.rider_id !== u.id) {
          const rows = await sb3(env, `drivers?auth_user_id=eq.${encodeURIComponent(u.id)}&select=id`);
          if (!rows?.[0] || rows[0].id !== r.driver_id) return fail4(env, "You cannot cancel this ride", 403);
        }
        return router_default.fetch(req, env, ctx);
      }
      return fail4(env, "Unsupported ride transition", 400);
    }
    return router_default.fetch(req, env, ctx);
  } catch (error) {
    return fail4(env, error.message || "Request failed", error.status || 500);
  }
} };

// src/whip/security.js
var JSON_HEADERS5 = { "content-type": "application/json; charset=utf-8" };
function cors4(env) {
  return { "access-control-allow-origin": env.ALLOWED_ORIGIN || "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", "access-control-allow-headers": "content-type,authorization,x-we-user-id,x-we-role", "access-control-max-age": "86400" };
}
__name(cors4, "cors");
function reply5(env, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS5, ...cors4(env) } });
}
__name(reply5, "reply");
function fail5(env, message, status = 400) {
  return reply5(env, { error: message }, status);
}
__name(fail5, "fail");
function sbHeaders4(env) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
}
__name(sbHeaders4, "sbHeaders");
async function sb4(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders4(env) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error("Database authorization check failed"), { status: 500 });
  return data;
}
__name(sb4, "sb");
async function user2(req, env) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: auth } });
  return res.ok ? res.json() : null;
}
__name(user2, "user");
async function requireUser4(req, env) {
  const u = await user2(req, env);
  if (!u) throw Object.assign(new Error("Authentication required"), { status: 401 });
  return u;
}
__name(requireUser4, "requireUser");
async function operatorAccess(env, u, tenantId) {
  const rows = await sb4(env, `operator_members?tenant_id=eq.${encodeURIComponent(tenantId)}&auth_user_id=eq.${encodeURIComponent(u.id)}&select=id`);
  return Boolean(rows?.length);
}
__name(operatorAccess, "operatorAccess");
async function driverAccess(env, u, driverId) {
  if (!driverId) return false;
  const rows = await sb4(env, `drivers?id=eq.${encodeURIComponent(driverId)}&auth_user_id=eq.${encodeURIComponent(u.id)}&select=id`);
  return Boolean(rows?.length);
}
__name(driverAccess, "driverAccess");
async function ride2(env, id) {
  const rows = await sb4(env, `rides?id=eq.${encodeURIComponent(id)}&select=*`);
  return rows?.[0] || null;
}
__name(ride2, "ride");
async function rental(env, id) {
  const rows = await sb4(env, `rental_bookings?id=eq.${encodeURIComponent(id)}&select=*`);
  return rows?.[0] || null;
}
__name(rental, "rental");
async function canAccessRide(env, u, r) {
  return r.rider_id === u.id || await driverAccess(env, u, r.driver_id) || await operatorAccess(env, u, r.tenant_id);
}
__name(canAccessRide, "canAccessRide");
async function canAccessRental(env, u, b) {
  return b.renter_id === u.id || await operatorAccess(env, u, b.tenant_id);
}
__name(canAccessRental, "canAccessRental");
var security_default = { async fetch(req, env, ctx) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors4(env) });
  const url = new URL(req.url), path = url.pathname.replace(/\/+$/, "") || "/";
  try {
    const rideGet = path.match(/^\/api\/rides\/([^/]+)$/);
    if (rideGet && req.method === "GET") {
      const u = await requireUser4(req, env), r = await ride2(env, rideGet[1]);
      if (!r) return fail5(env, "Ride not found", 404);
      if (!await canAccessRide(env, u, r)) return fail5(env, "Ride access denied", 403);
    }
    const ridePay = path.match(/^\/api\/rides\/([^/]+)\/payment-intent$/);
    if (ridePay && req.method === "POST") {
      const u = await requireUser4(req, env), r = await ride2(env, ridePay[1]);
      if (!r) return fail5(env, "Ride not found", 404);
      if (r.rider_id !== u.id) return fail5(env, "Only the rider can authorize this payment", 403);
    }
    const riderActive = path.match(/^\/api\/riders\/([^/]+)\/active$/);
    if (riderActive && req.method === "GET") {
      const u = await requireUser4(req, env);
      if (riderActive[1] !== u.id) return fail5(env, "Cannot read another rider account", 403);
    }
    const rentalProtected = path.match(/^\/api\/rentals\/bookings\/([^/]+)(?:\/(checkout|checkin|status|return))?$/);
    if (rentalProtected && ["GET", "POST", "PATCH"].includes(req.method)) {
      const u = await requireUser4(req, env), b = await rental(env, rentalProtected[1]);
      if (!b) return fail5(env, "Rental booking not found", 404);
      if (!await canAccessRental(env, u, b)) return fail5(env, "Rental access denied", 403);
      if (rentalProtected[2] === "checkout" && b.renter_id !== u.id) return fail5(env, "Only the renter can start checkout", 403);
    }
    const renterHistory = path.match(/^\/api\/renters\/([^/]+)\/rentals$/);
    if (renterHistory && req.method === "GET") {
      const u = await requireUser4(req, env);
      if (renterHistory[1] !== u.id) return fail5(env, "Cannot read another renter account", 403);
    }
    return gateway_default.fetch(req, env, ctx);
  } catch (error) {
    return fail5(env, error.message || "Request failed", error.status || 500);
  }
} };

// src/whip/identity.js
init_modules_watch_stub();
async function createIdentitySession(env, input = {}) {
  return stripeRequest(env, "identity/verification_sessions", {
    type: "document",
    provided_details: { email: input.email || void 0 },
    options: { document: { allowed_types: ["driving_license"], require_matching_selfie: true, require_live_capture: true } },
    metadata: { we_user_id: input.userId || "", purpose: input.purpose || "renter" }
  });
}
__name(createIdentitySession, "createIdentitySession");
async function retrieveIdentitySession(env, id) {
  return stripeRequest(env, `identity/verification_sessions/${encodeURIComponent(id)}`, {}, { method: "GET" });
}
__name(retrieveIdentitySession, "retrieveIdentitySession");

// src/whip/identity-gateway.js
var JSON_HEADERS6 = { "content-type": "application/json; charset=utf-8" };
function cors5(env) {
  return { "access-control-allow-origin": env.ALLOWED_ORIGIN || "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", "access-control-allow-headers": "content-type,authorization,x-we-user-id,x-we-role", "access-control-max-age": "86400" };
}
__name(cors5, "cors");
function reply6(env, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS6, ...cors5(env) } });
}
__name(reply6, "reply");
function fail6(env, message, status = 400) {
  return reply6(env, { error: message }, status);
}
__name(fail6, "fail");
function sbHeaders5(env, extra = {}) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", ...extra };
}
__name(sbHeaders5, "sbHeaders");
async function sb5(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: sbHeaders5(env, init.headers || {}) });
  const text2 = await res.text();
  let data = null;
  try {
    data = text2 ? JSON.parse(text2) : null;
  } catch {
    data = text2;
  }
  if (!res.ok) throw Object.assign(new Error("Identity persistence failed"), { status: 500 });
  return data;
}
__name(sb5, "sb");
async function user3(req, env) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: auth } });
  return res.ok ? res.json() : null;
}
__name(user3, "user");
async function requireUser5(req, env) {
  const u = await user3(req, env);
  if (!u) throw Object.assign(new Error("Authentication required"), { status: 401 });
  return u;
}
__name(requireUser5, "requireUser");
async function latest(env, userId, purpose) {
  const rows = await sb5(env, `identity_verifications?user_id=eq.${encodeURIComponent(userId)}&purpose=eq.${encodeURIComponent(purpose)}&order=created_at.desc&limit=1&select=*`);
  return rows?.[0] || null;
}
__name(latest, "latest");
async function verified(env, userId, purpose) {
  const record2 = await latest(env, userId, purpose);
  return Boolean(record2?.status === "verified");
}
__name(verified, "verified");
async function rental2(env, id) {
  const rows = await sb5(env, `rental_bookings?id=eq.${encodeURIComponent(id)}&select=*`);
  return rows?.[0] || null;
}
__name(rental2, "rental");
async function driver(env, id) {
  const rows = await sb5(env, `drivers?id=eq.${encodeURIComponent(id)}&select=*`);
  return rows?.[0] || null;
}
__name(driver, "driver");
async function persistEvent(env, object, status) {
  const userId = object.metadata?.we_user_id, purpose = object.metadata?.purpose || "renter";
  if (!userId) return;
  const patch3 = { status, updated_at: (/* @__PURE__ */ new Date()).toISOString(), last_error_code: object.last_error?.code || null };
  if (status === "verified") patch3.verified_at = (/* @__PURE__ */ new Date()).toISOString();
  const rows = await sb5(env, `identity_verifications?stripe_verification_session_id=eq.${encodeURIComponent(object.id)}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch3) });
  if (!rows?.length) await sb5(env, "identity_verifications", { method: "POST", body: JSON.stringify({ user_id: userId, purpose, stripe_verification_session_id: object.id, ...patch3 }) });
  if (purpose === "driver") await sb5(env, `drivers?auth_user_id=eq.${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify({ identity_verified: status === "verified", identity_verification_session_id: object.id }) });
}
__name(persistEvent, "persistEvent");
var identity_gateway_default = { async fetch(req, env, ctx) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors5(env) });
  const url = new URL(req.url), path = url.pathname.replace(/\/+$/, "") || "/";
  try {
    if (path === "/api/stripe/webhook" && req.method === "POST") {
      const clone = req.clone(), raw = await clone.text(), event = await verifyStripeWebhook(raw, req.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
      if (event.type === "identity.verification_session.verified") {
        await persistEvent(env, event.data.object, "verified");
        return reply6(env, { received: true, identity: true });
      }
      if (event.type === "identity.verification_session.requires_input" || event.type === "identity.verification_session.canceled") {
        await persistEvent(env, event.data.object, event.data.object.status || "requires_input");
        return reply6(env, { received: true, identity: true });
      }
      return security_default.fetch(req, env, ctx);
    }
    if (path === "/api/identity/session" && req.method === "POST") {
      const u = await requireUser5(req, env), body = await req.json(), purpose = ["renter", "driver"].includes(body.purpose) ? body.purpose : "renter";
      const prior = await latest(env, u.id, purpose);
      if (prior?.status === "verified") return reply6(env, { verification: prior, already_verified: true });
      const session = await createIdentitySession(env, { userId: u.id, email: u.email, purpose });
      await sb5(env, "identity_verifications", { method: "POST", body: JSON.stringify({ user_id: u.id, purpose, stripe_verification_session_id: session.id, status: session.status || "requires_input" }) });
      return reply6(env, { id: session.id, client_secret: session.client_secret, status: session.status, purpose });
    }
    if (path === "/api/identity/status" && req.method === "GET") {
      const u = await requireUser5(req, env), purpose = ["renter", "driver"].includes(url.searchParams.get("purpose")) ? url.searchParams.get("purpose") : "renter";
      let record2 = await latest(env, u.id, purpose);
      if (!record2) return reply6(env, { verification: null, verified: false });
      if (record2.status !== "verified") {
        const stripe = await retrieveIdentitySession(env, record2.stripe_verification_session_id);
        if (stripe.status !== record2.status) {
          await persistEvent(env, { ...stripe, metadata: { ...stripe.metadata || {}, we_user_id: u.id, purpose } }, stripe.status);
          record2 = await latest(env, u.id, purpose);
        }
      }
      return reply6(env, { verification: record2, verified: record2?.status === "verified" });
    }
    const rentalCheckin = path.match(/^\/api\/rentals\/bookings\/([^/]+)\/checkin$/);
    if (rentalCheckin && req.method === "PATCH") {
      const u = await requireUser5(req, env), booking = await rental2(env, rentalCheckin[1]);
      if (!booking) return fail6(env, "Rental booking not found", 404);
      if (booking.renter_id !== u.id) return fail6(env, "Only the renter can complete identity check-in", 403);
      const body = await req.clone().json();
      if (body.license_verified === true) {
        if (!await verified(env, u.id, "renter")) return fail6(env, "Complete Stripe Identity driver-license verification first", 409);
        body.license_verified = true;
        body.identity_verified = true;
      }
      const headers7 = new Headers(req.headers);
      headers7.set("content-type", "application/json");
      return security_default.fetch(new Request(req.url, { method: "PATCH", headers: headers7, body: JSON.stringify(body) }), env, ctx);
    }
    const rentalStatus = path.match(/^\/api\/rentals\/bookings\/([^/]+)\/status$/);
    if (rentalStatus && req.method === "PATCH") {
      const u = await requireUser5(req, env), body = await req.clone().json();
      if (String(body.status || "").toUpperCase() === "ACTIVE" && !await verified(env, u.id, "renter")) return fail6(env, "Verified renter identity is required before vehicle pickup", 409);
    }
    const driverPresence = path.match(/^\/api\/drivers\/([^/]+)\/presence$/);
    if (driverPresence && req.method === "PATCH") {
      const u = await requireUser5(req, env), d = await driver(env, driverPresence[1]);
      if (!d || d.auth_user_id !== u.id) return fail6(env, "Driver access denied", 403);
      const body = await req.clone().json();
      if (body.online === true && !await verified(env, u.id, "driver")) return fail6(env, "Complete driver identity verification before going online", 409);
    }
    if (path === "/api/offers" && req.method === "GET") {
      const u = await requireUser5(req, env);
      if (!await verified(env, u.id, "driver")) return fail6(env, "Complete driver identity verification before receiving offers", 409);
    }
    return security_default.fetch(req, env, ctx);
  } catch (error) {
    return fail6(env, error.message || "Request failed", error.status || 500);
  }
} };

// src/geo/index.js
init_modules_watch_stub();

// src/geo/adapters.js
init_modules_watch_stub();

// src/geo/source-registry.js
init_modules_watch_stub();
var SOURCE_CLASSES = Object.freeze({
  PUBLIC_OPEN: "PUBLIC_OPEN",
  NONPROFIT: "NONPROFIT",
  ACADEMIC: "ACADEMIC",
  COMMERCIAL: "COMMERCIAL",
  INTERNAL: "INTERNAL",
  RESTRICTED: "RESTRICTED"
});
var PERSISTENCE = Object.freeze({
  PERSISTENT: "persistent",
  TRANSIENT: "transient",
  NONE: "none"
});
function source({
  key,
  name,
  sourceClass = SOURCE_CLASSES.PUBLIC_OPEN,
  credentialEnv = [],
  optionalCredentialEnv = [],
  capabilities = [],
  lane = "OPEN",
  adapter = null,
  transport = "http",
  persistence = PERSISTENCE.PERSISTENT,
  attribution = null,
  upstream = null
}) {
  return Object.freeze({
    key,
    name,
    sourceClass,
    credentialEnv: Object.freeze([...credentialEnv]),
    optionalCredentialEnv: Object.freeze([...optionalCredentialEnv]),
    capabilities: Object.freeze([...capabilities]),
    lane,
    adapter,
    transport,
    persistence,
    attribution,
    upstream
  });
}
__name(source, "source");
var SOURCES = Object.freeze([
  source({ key: "census", name: "U.S. Census Data API", credentialEnv: ["CENSUS_API_KEY"], capabilities: ["demographics", "housing", "commuting", "business"], adapter: "census", upstream: "https://api.census.gov" }),
  source({ key: "eia", name: "U.S. Energy Information Administration", credentialEnv: ["EIA_API_KEY"], capabilities: ["electricity", "generation", "demand", "prices", "grid-flows"], adapter: "eia", upstream: "https://api.eia.gov" }),
  source({ key: "data_commons", name: "Data Commons", credentialEnv: ["DATA_COMMONS_API_KEY"], capabilities: ["knowledge-graph", "statistics", "place-variables"], adapter: "data_commons", upstream: "https://api.datacommons.org" }),
  source({ key: "bls", name: "Bureau of Labor Statistics", credentialEnv: ["BLS_API_KEY"], capabilities: ["labor", "wages", "employment", "prices"], adapter: "bls", upstream: "https://api.bls.gov" }),
  source({ key: "fred", name: "Federal Reserve Economic Data", credentialEnv: ["FRED_API_KEY"], capabilities: ["macroeconomics", "regional-economics", "housing", "finance"], adapter: "fred", upstream: "https://api.stlouisfed.org" }),
  source({ key: "usaspending", name: "USAspending", capabilities: ["federal-awards", "contracts", "grants", "recipients"], adapter: "usaspending", upstream: "https://api.usaspending.gov" }),
  source({ key: "grants_gov", name: "Grants.gov", capabilities: ["grant-opportunities", "agencies"], adapter: "grants_gov", upstream: "https://api.grants.gov" }),
  source({ key: "epa", name: "U.S. Environmental Protection Agency", capabilities: ["facilities", "air", "water", "tri", "compliance"], adapter: "epa", upstream: "https://data.epa.gov" }),
  source({ key: "usgs", name: "U.S. Geological Survey", capabilities: ["earthquakes", "geology", "hazards"], adapter: "usgs", upstream: "https://earthquake.usgs.gov", attribution: "Data courtesy of the U.S. Geological Survey" }),
  source({ key: "open_meteo", name: "Open-Meteo", capabilities: ["weather", "forecast", "historical-weather"], adapter: "open_meteo", upstream: "https://api.open-meteo.com", attribution: "Weather data by Open-Meteo.com" }),
  source({ key: "nhtsa", name: "National Highway Traffic Safety Administration", capabilities: ["vehicle-safety", "recalls", "complaints", "crashes"], adapter: "nhtsa", upstream: "https://api.nhtsa.gov" }),
  source({ key: "celestrak", name: "CelesTrak", capabilities: ["satellite-orbits"], adapter: "celestrak", upstream: "https://celestrak.org", attribution: "CelesTrak (celestrak.org), Dr. T.S. Kelso" }),
  // GEV-native keyless/provider-backed runtime sources.
  source({ key: "overpass", name: "OpenStreetMap Overpass", capabilities: ["roads", "infrastructure", "military-installations", "poi"], adapter: "overpass", upstream: "https://overpass-api.de/api", attribution: "\xA9 OpenStreetMap contributors" }),
  source({ key: "adsb_lol", name: "ADSB.lol", capabilities: ["aircraft", "military-aircraft", "aircraft-traces"], adapter: "adsb_lol", upstream: "https://api.adsb.lol", attribution: "adsb.lol contributors \u2014 ODbL 1.0" }),
  source({ key: "launch_library2", name: "Launch Library 2", optionalCredentialEnv: ["LL2_API_TOKEN"], capabilities: ["launches", "missions", "pads", "spaceflight-events"], adapter: "launch_library2", upstream: "https://ll.thespacedevs.com", attribution: "Launch Library 2 \u2014 The Space Devs" }),
  source({ key: "radio_browser", name: "Radio Browser", capabilities: ["radio-stations", "station-tags", "geolocated-audio-directory"], adapter: "radio_browser", upstream: "https://all.api.radio-browser.info", attribution: "Radio Browser" }),
  source({ key: "reearth_terrain", name: "Re:Earth Terrain / Mapterhorn", capabilities: ["terrain", "height"], adapter: "reearth_terrain", upstream: "https://tiles.mapterhorn.com", attribution: "Re:Earth Terrain / Mapterhorn (CC BY 4.0)" }),
  source({ key: "gbfs", name: "General Bikeshare Feed Specification", capabilities: ["bikeshare", "stations", "vehicle-availability"], adapter: "gbfs", upstream: "provider-specific", attribution: "Per-feed operator attribution required" }),
  source({ key: "cctv", name: "Public Traffic Camera Catalogs", capabilities: ["traffic-cameras", "public-camera-catalog"], adapter: "cctv", persistence: PERSISTENCE.TRANSIENT, upstream: "provider-specific", attribution: "Per-camera provider attribution required" }),
  source({ key: "nominatim", name: "OpenStreetMap Nominatim", capabilities: ["reverse-geocoding", "place-labels"], adapter: "nominatim", persistence: PERSISTENCE.TRANSIENT, upstream: "https://nominatim.openstreetmap.org", attribution: "\xA9 OpenStreetMap contributors" }),
  source({ key: "gdelt", name: "GDELT Project DOC 2.0", capabilities: ["regional-news", "events", "headlines"], adapter: "gdelt", persistence: PERSISTENCE.TRANSIENT, upstream: "https://api.gdeltproject.org", attribution: "GDELT Project" }),
  // Authenticated/restricted lanes.
  source({ key: "nasa_firms", name: "NASA FIRMS Active Fires", credentialEnv: ["FIRMS_MAP_KEY"], capabilities: ["active-fires", "thermal-anomalies"], adapter: "nasa_firms", upstream: "https://firms.modaps.eosdis.nasa.gov", attribution: "NASA FIRMS" }),
  source({ key: "copernicus", name: "Copernicus Data Space Ecosystem", credentialEnv: ["COPERNICUS_CLIENT_ID", "COPERNICUS_CLIENT_SECRET"], capabilities: ["sentinel-imagery", "stac", "earth-observation"], adapter: "copernicus", upstream: "https://catalogue.dataspace.copernicus.eu" }),
  source({ key: "planet_research", name: "Planet Education & Research", sourceClass: SOURCE_CLASSES.ACADEMIC, credentialEnv: ["PLANET_RESEARCH_API_KEY"], capabilities: ["planet-scope", "change-detection", "earth-observation"], lane: "SCSU_RESEARCH", adapter: "planet", upstream: "https://api.planet.com" }),
  source({ key: "opensky_research", name: "OpenSky Network Research", sourceClass: SOURCE_CLASSES.ACADEMIC, credentialEnv: ["OPENSKY_CLIENT_ID", "OPENSKY_CLIENT_SECRET"], capabilities: ["aircraft", "flight-history"], lane: "SCSU_RESEARCH", adapter: "opensky", persistence: PERSISTENCE.TRANSIENT, upstream: "https://opensky-network.org", attribution: "OpenSky Network" }),
  source({ key: "tomtom", name: "TomTom Traffic", sourceClass: SOURCE_CLASSES.COMMERCIAL, credentialEnv: ["TOMTOM_API_KEY"], capabilities: ["traffic", "flow-segments", "flow-tiles", "routing"], lane: "COMMERCIAL", adapter: "tomtom", persistence: PERSISTENCE.TRANSIENT, upstream: "https://api.tomtom.com", attribution: "Traffic flow data \xA9 TomTom" }),
  source({ key: "aisstream", name: "AISStream", sourceClass: SOURCE_CLASSES.COMMERCIAL, credentialEnv: ["AISSTREAM_API_KEY"], capabilities: ["vessels", "ais"], lane: "COMMERCIAL", adapter: "aisstream", transport: "websocket", persistence: PERSISTENCE.TRANSIENT, upstream: "wss://stream.aisstream.io", attribution: "AISStream.io" }),
  source({ key: "mapbox", name: "Mapbox", sourceClass: SOURCE_CLASSES.COMMERCIAL, credentialEnv: ["MAPBOX_ACCESS_TOKEN"], capabilities: ["maps", "tiles", "routing", "geocoding"], lane: "COMMERCIAL_OR_NONPROFIT", adapter: "mapbox", persistence: PERSISTENCE.TRANSIENT, upstream: "https://api.mapbox.com" }),
  source({ key: "google_maps", name: "Google Maps Platform", sourceClass: SOURCE_CLASSES.COMMERCIAL, credentialEnv: ["GOOGLE_MAPS_API_KEY"], capabilities: ["maps", "places", "geocoding", "3d-tiles"], lane: "COMMERCIAL_OR_NONPROFIT", adapter: "google_maps", persistence: PERSISTENCE.NONE, upstream: "https://maps.googleapis.com", attribution: "Google Maps" }),
  source({ key: "cesium_ion", name: "Cesium ion", sourceClass: SOURCE_CLASSES.COMMERCIAL, credentialEnv: ["CESIUM_ION_TOKEN"], capabilities: ["3d-tiles", "terrain", "viewer-assets"], lane: "VIEWER", adapter: "cesium_ion", persistence: PERSISTENCE.NONE, upstream: "https://api.cesium.com", attribution: "Cesium ion" })
]);
var SOURCE_BY_KEY = new Map(SOURCES.map((item) => [item.key, item]));
function sourceByKey(key) {
  return SOURCE_BY_KEY.get(String(key || "").trim()) || null;
}
__name(sourceByKey, "sourceByKey");
function sourceConfigured(item, env) {
  return item.credentialEnv.every((key) => Boolean(env?.[key]));
}
__name(sourceConfigured, "sourceConfigured");
function sourceCatalog(env) {
  return SOURCES.map((item) => ({
    key: item.key,
    name: item.name,
    source_class: item.sourceClass,
    lane: item.lane,
    capabilities: item.capabilities,
    transport: item.transport,
    persistence: item.persistence,
    attribution: item.attribution,
    credential_required: item.credentialEnv.length > 0,
    credential_bindings: item.credentialEnv,
    optional_credential_bindings: item.optionalCredentialEnv,
    configured: sourceConfigured(item, env)
  }));
}
__name(sourceCatalog, "sourceCatalog");

// src/geo/adapters.js
var DEFAULT_TIMEOUT_MS = 15e3;
var MAX_PROVIDER_ROWS = 2e3;
var SENSITIVE_QUERY_KEYS = /* @__PURE__ */ new Set(["key", "api_key", "access_token", "token", "map_key"]);
var GeoAdapterError = class extends Error {
  static {
    __name(this, "GeoAdapterError");
  }
  constructor(message, status = 400, code = "geo_adapter_error", detail = void 0) {
    super(message);
    this.name = "GeoAdapterError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
};
function finite(value, name, { min = -Infinity, max = Infinity, required = true } = {}) {
  if ((value === void 0 || value === null || value === "") && !required) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new GeoAdapterError(`${name} must be a finite number between ${min} and ${max}`, 400, "invalid_parameter");
  }
  return parsed;
}
__name(finite, "finite");
function integer(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = null } = {}) {
  if (value === void 0 || value === null || value === "") {
    if (fallback !== null) return fallback;
    throw new GeoAdapterError(`${name} is required`, 400, "invalid_parameter");
  }
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new GeoAdapterError(`${name} must be an integer between ${min} and ${max}`, 400, "invalid_parameter");
  }
  return parsed;
}
__name(integer, "integer");
function stringValue(value, name, { required = true, max = 500, pattern = null } = {}) {
  if ((value === void 0 || value === null || value === "") && !required) return null;
  const text2 = String(value || "").trim();
  if (!text2 || text2.length > max || pattern && !pattern.test(text2)) {
    throw new GeoAdapterError(`${name} is invalid`, 400, "invalid_parameter");
  }
  return text2;
}
__name(stringValue, "stringValue");
function latLon(input) {
  return {
    lat: finite(input?.lat ?? input?.latitude, "lat", { min: -90, max: 90 }),
    lon: finite(input?.lon ?? input?.lng ?? input?.longitude, "lon", { min: -180, max: 180 })
  };
}
__name(latLon, "latLon");
function clampRows(rows) {
  return Array.isArray(rows) ? rows.slice(0, MAX_PROVIDER_ROWS) : [];
}
__name(clampRows, "clampRows");
function timestamp(value, fallback = (/* @__PURE__ */ new Date()).toISOString()) {
  if (!value) return fallback;
  const date = new Date(typeof value === "number" && value < 1e12 ? value * 1e3 : value);
  return Number.isNaN(date.valueOf()) ? fallback : date.toISOString();
}
__name(timestamp, "timestamp");
function point(lat, lon) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;
  const y = Number(lat);
  const x = Number(lon);
  if (y < -90 || y > 90 || x < -180 || x > 180) return null;
  return { lat: y, lon: x };
}
__name(point, "point");
function record(kind, fields) {
  return { kind, ...fields };
}
__name(record, "record");
function redactedUrl(value) {
  const url = new URL(String(value));
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.set(key, "[redacted]");
  }
  return url.toString();
}
__name(redactedUrl, "redactedUrl");
async function providerFetch(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "McCluster-Spatial/1.0 (https://mccluster.org)",
        ...init.headers || {}
      }
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new GeoAdapterError(
        `Provider request failed with ${response.status}`,
        response.status === 429 ? 429 : 502,
        "provider_error",
        { provider_status: response.status, body: body.slice(0, 600) }
      );
    }
    return response;
  } catch (error) {
    if (error instanceof GeoAdapterError) throw error;
    if (error?.name === "AbortError") throw new GeoAdapterError("Provider request timed out", 504, "provider_timeout");
    throw new GeoAdapterError("Provider request failed", 502, "provider_network_error");
  } finally {
    clearTimeout(timer);
  }
}
__name(providerFetch, "providerFetch");
async function jsonFetch(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const response = await providerFetch(url, init, timeoutMs);
  const text2 = await response.text();
  try {
    return { data: text2 ? JSON.parse(text2) : null, response };
  } catch {
    throw new GeoAdapterError("Provider returned invalid JSON", 502, "provider_invalid_json");
  }
}
__name(jsonFetch, "jsonFetch");
function result(sourceKey, operation, sourceUrl, records, raw, extra = {}) {
  const source2 = sourceByKey(sourceKey);
  return {
    source: sourceKey,
    operation,
    fetched_at: (/* @__PURE__ */ new Date()).toISOString(),
    source_url: sourceUrl ? redactedUrl(sourceUrl) : null,
    attribution: source2?.attribution || null,
    persistence: source2?.persistence || PERSISTENCE.PERSISTENT,
    records: clampRows(records),
    raw,
    ...extra
  };
}
__name(result, "result");
function requireCredentials(sourceKey, env) {
  const source2 = sourceByKey(sourceKey);
  if (!source2) throw new GeoAdapterError("Unknown spatial source", 404, "unknown_source");
  if (!sourceConfigured(source2, env)) {
    throw new GeoAdapterError(
      `${source2.name} credentials are not configured`,
      503,
      "credential_missing",
      { required_bindings: source2.credentialEnv }
    );
  }
  return source2;
}
__name(requireCredentials, "requireCredentials");
function paramsFromObject(url, values, { skip = [] } = {}) {
  const ignored = new Set(skip);
  for (const [key, value] of Object.entries(values || {})) {
    if (ignored.has(key) || value === void 0 || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else if (["string", "number", "boolean"].includes(typeof value)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}
__name(paramsFromObject, "paramsFromObject");
function assertPublicHttpsUrl(value) {
  const url = new URL(stringValue(value, "url", { max: 2e3 }));
  if (url.protocol !== "https:") throw new GeoAdapterError("Only HTTPS provider URLs are allowed", 400, "unsafe_url");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "::1" || host === "0.0.0.0") {
    throw new GeoAdapterError("Private/local provider URLs are not allowed", 400, "unsafe_url");
  }
  return url;
}
__name(assertPublicHttpsUrl, "assertPublicHttpsUrl");
function parseCsv(text2) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text2.length; i += 1) {
    const char = text2[i];
    if (quoted) {
      if (char === '"' && text2[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers7 = rows.shift() || [];
  return rows.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(headers7.map((key, index) => [key, values[index] ?? ""])));
}
__name(parseCsv, "parseCsv");
async function usgs(input) {
  const { lat, lon } = latLon(input);
  const radiusKm = finite(input?.radius_km ?? 250, "radius_km", { min: 0.1, max: 2e3 });
  const limit = integer(input?.limit ?? 250, "limit", { min: 1, max: 1e3 });
  const url = new URL("https://earthquake.usgs.gov/fdsnws/event/1/query");
  url.searchParams.set("format", "geojson");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("maxradiuskm", String(radiusKm));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("orderby", "time");
  if (input?.min_magnitude !== void 0) url.searchParams.set("minmagnitude", String(finite(input.min_magnitude, "min_magnitude", { min: -2, max: 10 })));
  if (input?.start_time) url.searchParams.set("starttime", timestamp(input.start_time));
  const { data } = await jsonFetch(url);
  const records = clampRows(data?.features).map((feature) => {
    const coordinates = feature?.geometry?.coordinates || [];
    return record("event", {
      external_id: String(feature?.id || feature?.properties?.code || crypto.randomUUID()),
      event_type: "earthquake",
      name: feature?.properties?.place || "Earthquake",
      point: point(coordinates[1], coordinates[0]),
      severity: Number.isFinite(Number(feature?.properties?.mag)) ? Number(feature.properties.mag) : null,
      observed_at: timestamp(feature?.properties?.time),
      source_url: feature?.properties?.url || null,
      properties: feature?.properties || {}
    });
  });
  return result("usgs", "earthquakes", url, records, data);
}
__name(usgs, "usgs");
async function openMeteo(input) {
  const { lat, lon } = latLon(input);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("forecast_days", String(integer(input?.forecast_days ?? 3, "forecast_days", { min: 1, max: 16 })));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,cloud_cover,visibility,wind_speed_10m,wind_direction_10m");
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability,precipitation,weather_code,cloud_cover,visibility,wind_speed_10m,wind_direction_10m");
  const { data } = await jsonFetch(url);
  const observedAt = timestamp(data?.current?.time);
  const location = point(data?.latitude ?? lat, data?.longitude ?? lon);
  const records = [
    record("entity", {
      external_id: `weather:${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`,
      entity_type: "weather_cell",
      name: "Local weather",
      point: location,
      observed_at: observedAt,
      properties: { elevation: data?.elevation, timezone: data?.timezone }
    }),
    ...Object.entries(data?.current || {}).filter(([key, value]) => key !== "time" && Number.isFinite(Number(value))).map(([key, value]) => record("observation", {
      external_id: `weather:${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}:${key}:${observedAt}`,
      observation_type: "weather",
      metric: key,
      value_number: Number(value),
      unit: data?.current_units?.[key] || null,
      point: location,
      observed_at: observedAt,
      properties: {}
    }))
  ];
  return result("open_meteo", "forecast", url, records, data);
}
__name(openMeteo, "openMeteo");
async function celestrak(input) {
  const group = stringValue(input?.group || "active", "group", { max: 40, pattern: /^[A-Za-z0-9_-]+$/ }).toUpperCase();
  const url = new URL("https://celestrak.org/NORAD/elements/gp.php");
  url.searchParams.set("GROUP", group);
  url.searchParams.set("FORMAT", "JSON");
  const { data } = await jsonFetch(url);
  const records = clampRows(data).map((item) => record("entity", {
    external_id: String(item?.NORAD_CAT_ID || item?.OBJECT_ID || item?.OBJECT_NAME || crypto.randomUUID()),
    entity_type: "satellite",
    name: item?.OBJECT_NAME || item?.OBJECT_ID || "Satellite",
    point: null,
    observed_at: timestamp(item?.EPOCH),
    properties: item || {}
  }));
  return result("celestrak", "gp", url, records, data);
}
__name(celestrak, "celestrak");
async function adsbLol(input) {
  const { lat, lon } = latLon(input);
  const radius = finite(input?.radius_nm ?? input?.radius ?? 125, "radius_nm", { min: 1, max: 250 });
  const url = new URL(`https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${radius}`);
  const { data } = await jsonFetch(url);
  const records = clampRows(data?.ac).map((aircraft) => record("entity", {
    external_id: String(aircraft?.hex || aircraft?.icao || crypto.randomUUID()).replace(/^~/, ""),
    entity_type: aircraft?.mil ? "military_aircraft" : "aircraft",
    name: String(aircraft?.flight || aircraft?.r || aircraft?.hex || "Aircraft").trim(),
    point: point(aircraft?.lat, aircraft?.lon),
    observed_at: timestamp(Date.now() / 1e3 - Number(aircraft?.seen || 0)),
    properties: aircraft || {}
  }));
  return result("adsb_lol", "aircraft", url, records, data);
}
__name(adsbLol, "adsbLol");
async function overpass(input) {
  const operation = input?.operation || "infrastructure";
  const timeout = 25;
  let query;
  if (input?.bbox) {
    const values = String(input.bbox).split(",").map(Number);
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) throw new GeoAdapterError("bbox must be south,west,north,east", 400, "invalid_parameter");
    const [south, west, north, east] = values;
    finite(south, "south", { min: -90, max: 90 });
    finite(north, "north", { min: -90, max: 90 });
    finite(west, "west", { min: -180, max: 180 });
    finite(east, "east", { min: -180, max: 180 });
    const selector = operation === "military" ? `nwr["military"](${south},${west},${north},${east});nwr["landuse"="military"](${south},${west},${north},${east});` : `way["highway"](${south},${west},${north},${east});nwr["power"](${south},${west},${north},${east});nwr["man_made"](${south},${west},${north},${east});`;
    query = `[out:json][timeout:${timeout}];(${selector});out center tags;`;
  } else {
    const { lat, lon } = latLon(input);
    const radius = integer(input?.radius_m ?? 5e3, "radius_m", { min: 50, max: 1e5 });
    const selector = operation === "military" ? `nwr(around:${radius},${lat},${lon})["military"];nwr(around:${radius},${lat},${lon})["landuse"="military"];` : `way(around:${radius},${lat},${lon})["highway"];nwr(around:${radius},${lat},${lon})["power"];nwr(around:${radius},${lat},${lon})["man_made"];`;
    query = `[out:json][timeout:${timeout}];(${selector});out center tags;`;
  }
  const url = new URL("https://overpass-api.de/api/interpreter");
  const { data } = await jsonFetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }).toString()
  }, 3e4);
  const records = clampRows(data?.elements).map((item) => {
    const p = point(item?.lat ?? item?.center?.lat, item?.lon ?? item?.center?.lon);
    return record("entity", {
      external_id: `${item?.type || "osm"}:${item?.id}`,
      entity_type: operation === "military" ? "mapped_military_installation" : `osm_${item?.type || "feature"}`,
      name: item?.tags?.name || item?.tags?.ref || `${item?.type || "OSM"} ${item?.id}`,
      point: p,
      observed_at: (/* @__PURE__ */ new Date()).toISOString(),
      properties: { type: item?.type, id: item?.id, tags: item?.tags || {}, center: item?.center || null }
    });
  });
  return result("overpass", operation, url, records, data);
}
__name(overpass, "overpass");
async function launchLibrary(input, env) {
  const limit = integer(input?.limit ?? 30, "limit", { min: 1, max: 100 });
  const mode = ["list", "normal", "detailed"].includes(input?.mode) ? input.mode : "detailed";
  const url = new URL("https://ll.thespacedevs.com/2.3.0/launches/upcoming/");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("mode", mode);
  url.searchParams.set("ordering", "net");
  const headers7 = {};
  if (env?.LL2_API_TOKEN) headers7.authorization = `Token ${env.LL2_API_TOKEN}`;
  const { data } = await jsonFetch(url, { headers: headers7 });
  const records = clampRows(data?.results).map((launch) => record("event", {
    external_id: String(launch?.id || launch?.slug || crypto.randomUUID()),
    event_type: "space_launch",
    name: launch?.name || "Space launch",
    point: point(launch?.pad?.latitude, launch?.pad?.longitude),
    severity: null,
    status: launch?.status?.abbrev || launch?.status?.name || null,
    starts_at: timestamp(launch?.window_start || launch?.net),
    ends_at: launch?.window_end ? timestamp(launch.window_end) : null,
    observed_at: timestamp(launch?.last_updated),
    source_url: launch?.url || null,
    properties: launch || {}
  }));
  return result("launch_library2", "upcoming_launches", url, records, data);
}
__name(launchLibrary, "launchLibrary");
async function grantsGov(input) {
  const url = new URL("https://api.grants.gov/v1/api/search2");
  const body = {
    keyword: String(input?.keyword || "").slice(0, 200),
    rows: integer(input?.rows ?? 50, "rows", { min: 1, max: 100 }),
    startRecordNum: integer(input?.start_record ?? 0, "start_record", { min: 0, max: 1e4 })
  };
  for (const key of ["oppStatuses", "agencies", "fundingCategories", "eligibilities"]) {
    if (input?.[key] !== void 0) body[key] = input[key];
  }
  const { data } = await jsonFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const opportunities = data?.data?.oppHits || data?.oppHits || data?.data?.opportunities || data?.opportunities || [];
  const records = clampRows(opportunities).map((opp) => record("event", {
    external_id: String(opp?.id || opp?.oppNumber || opp?.opportunityNumber || crypto.randomUUID()),
    event_type: "grant_opportunity",
    name: opp?.title || opp?.opportunityTitle || "Grant opportunity",
    point: null,
    status: opp?.oppStatus || opp?.status || null,
    starts_at: opp?.openDate ? timestamp(opp.openDate) : null,
    ends_at: opp?.closeDate ? timestamp(opp.closeDate) : null,
    observed_at: (/* @__PURE__ */ new Date()).toISOString(),
    properties: opp || {}
  }));
  return result("grants_gov", "search", url, records, data);
}
__name(grantsGov, "grantsGov");
async function usaSpending(input) {
  const url = new URL("https://api.usaspending.gov/api/v2/search/spending_by_award/");
  const body = input?.body && typeof input.body === "object" ? input.body : {
    filters: input?.filters || {
      time_period: [{ start_date: input?.start_date || "2025-01-01", end_date: input?.end_date || "2026-12-31" }],
      award_type_codes: input?.award_type_codes || ["02", "03", "04", "05"]
    },
    fields: input?.fields || ["Award ID", "Recipient Name", "Award Amount", "Start Date", "End Date", "Awarding Agency", "Award Type"],
    page: integer(input?.page ?? 1, "page", { min: 1, max: 1e3 }),
    limit: integer(input?.limit ?? 50, "limit", { min: 1, max: 100 }),
    sort: input?.sort || "Award Amount",
    order: input?.order === "asc" ? "asc" : "desc"
  };
  const { data } = await jsonFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const rows = data?.results || [];
  const records = clampRows(rows).map((award) => record("entity", {
    external_id: String(award?.["Award ID"] || award?.internal_id || award?.generated_unique_award_id || crypto.randomUUID()),
    entity_type: "federal_award",
    name: award?.["Recipient Name"] || award?.recipient_name || "Federal award",
    point: null,
    observed_at: (/* @__PURE__ */ new Date()).toISOString(),
    properties: award || {}
  }));
  return result("usaspending", "spending_by_award", url, records, data);
}
__name(usaSpending, "usaSpending");
async function nhtsa(input) {
  const make = encodeURIComponent(stringValue(input?.make, "make", { max: 80 }));
  const model = encodeURIComponent(stringValue(input?.model, "model", { max: 80 }));
  const year = integer(input?.model_year ?? input?.year, "model_year", { min: 1940, max: (/* @__PURE__ */ new Date()).getUTCFullYear() + 2 });
  const url = new URL(`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${make}&model=${model}&modelYear=${year}`);
  const { data } = await jsonFetch(url);
  const rows = data?.results || data?.Results || [];
  const records = clampRows(rows).map((recall) => record("event", {
    external_id: String(recall?.NHTSACampaignNumber || recall?.nhtsaCampaignNumber || crypto.randomUUID()),
    event_type: "vehicle_recall",
    name: recall?.Component || recall?.component || `${year} ${decodeURIComponent(make)} ${decodeURIComponent(model)} recall`,
    point: null,
    status: null,
    starts_at: recall?.ReportReceivedDate ? timestamp(recall.ReportReceivedDate) : null,
    observed_at: (/* @__PURE__ */ new Date()).toISOString(),
    properties: recall || {}
  }));
  return result("nhtsa", "recalls", url, records, data);
}
__name(nhtsa, "nhtsa");
async function census(input, env) {
  requireCredentials("census", env);
  const year = integer(input?.year ?? 2024, "year", { min: 1990, max: (/* @__PURE__ */ new Date()).getUTCFullYear() });
  const dataset = stringValue(input?.dataset || "acs/acs5", "dataset", { max: 100, pattern: /^[A-Za-z0-9_/-]+$/ });
  const get = stringValue(input?.get || "NAME,B01001_001E", "get", { max: 1e3, pattern: /^[A-Za-z0-9_,]+$/ });
  const geography = stringValue(input?.for || "state:*", "for", { max: 200 });
  const url = new URL(`https://api.census.gov/data/${year}/${dataset}`);
  url.searchParams.set("get", get);
  url.searchParams.set("for", geography);
  if (input?.in) url.searchParams.set("in", stringValue(input.in, "in", { max: 200 }));
  url.searchParams.set("key", env.CENSUS_API_KEY);
  const { data } = await jsonFetch(url);
  const headers7 = Array.isArray(data?.[0]) ? data[0] : [];
  const rows = Array.isArray(data) ? data.slice(1) : [];
  const records = clampRows(rows).map((values, index) => {
    const properties = Object.fromEntries(headers7.map((key, i) => [key, values?.[i]]));
    return record("entity", {
      external_id: `census:${year}:${dataset}:${Object.values(properties).slice(-4).join(":") || index}`,
      entity_type: "census_geography",
      name: properties.NAME || "Census geography",
      point: null,
      observed_at: (/* @__PURE__ */ new Date()).toISOString(),
      properties
    });
  });
  return result("census", "dataset", url, records, data);
}
__name(census, "census");
async function fred(input, env) {
  requireCredentials("fred", env);
  const seriesId = stringValue(input?.series_id, "series_id", { max: 80, pattern: /^[A-Za-z0-9_.-]+$/ });
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", env.FRED_API_KEY);
  url.searchParams.set("file_type", "json");
  if (input?.observation_start) url.searchParams.set("observation_start", String(input.observation_start));
  if (input?.observation_end) url.searchParams.set("observation_end", String(input.observation_end));
  const { data } = await jsonFetch(url);
  const records = clampRows(data?.observations).map((obs) => record("observation", {
    external_id: `fred:${seriesId}:${obs.date}`,
    observation_type: "economic_series",
    metric: seriesId,
    value_number: Number.isFinite(Number(obs.value)) ? Number(obs.value) : null,
    value_text: obs.value,
    unit: null,
    point: null,
    observed_at: timestamp(`${obs.date}T00:00:00Z`),
    properties: obs || {}
  }));
  return result("fred", "series_observations", url, records, data);
}
__name(fred, "fred");
async function bls(input, env) {
  requireCredentials("bls", env);
  const seriesIds = Array.isArray(input?.series_ids) ? input.series_ids.slice(0, 50).map((id) => stringValue(id, "series_id", { max: 80 })) : [stringValue(input?.series_id, "series_id", { max: 80 })];
  const startyear = String(integer(input?.start_year ?? (/* @__PURE__ */ new Date()).getUTCFullYear() - 3, "start_year", { min: 1940, max: (/* @__PURE__ */ new Date()).getUTCFullYear() }));
  const endyear = String(integer(input?.end_year ?? (/* @__PURE__ */ new Date()).getUTCFullYear(), "end_year", { min: Number(startyear), max: (/* @__PURE__ */ new Date()).getUTCFullYear() }));
  const url = new URL("https://api.bls.gov/publicAPI/v2/timeseries/data/");
  const body = { seriesid: seriesIds, startyear, endyear, registrationkey: env.BLS_API_KEY };
  const { data } = await jsonFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const records = [];
  for (const series of data?.Results?.series || []) {
    for (const obs of series?.data || []) {
      records.push(record("observation", {
        external_id: `bls:${series.seriesID}:${obs.year}:${obs.period}`,
        observation_type: "labor_series",
        metric: series.seriesID,
        value_number: Number.isFinite(Number(obs.value)) ? Number(obs.value) : null,
        value_text: obs.value,
        unit: null,
        point: null,
        observed_at: `${obs.year}-01-01T00:00:00.000Z`,
        properties: obs || {}
      }));
    }
  }
  return result("bls", "timeseries", url, records, data);
}
__name(bls, "bls");
async function eia(input, env) {
  requireCredentials("eia", env);
  const route = stringValue(input?.route || "electricity/rto/region-data/data/", "route", { max: 300, pattern: /^[A-Za-z0-9_./-]+$/ });
  const url = new URL(`https://api.eia.gov/v2/${route.replace(/^\/+/, "")}`);
  url.searchParams.set("api_key", env.EIA_API_KEY);
  paramsFromObject(url, input?.params || {});
  if (!url.searchParams.has("length")) url.searchParams.set("length", String(integer(input?.limit ?? 100, "limit", { min: 1, max: 5e3 })));
  const { data } = await jsonFetch(url);
  const rows = data?.response?.data || [];
  const records = clampRows(rows).map((item, index) => record("observation", {
    external_id: `eia:${route}:${item?.period || index}:${item?.respondent || item?.region || ""}`,
    observation_type: "energy_series",
    metric: item?.type || item?.series || route,
    value_number: Number.isFinite(Number(item?.value)) ? Number(item.value) : null,
    value_text: item?.value === void 0 ? null : String(item.value),
    unit: item?.["value-units"] || item?.units || null,
    point: null,
    observed_at: item?.period ? timestamp(item.period) : (/* @__PURE__ */ new Date()).toISOString(),
    properties: item || {}
  }));
  return result("eia", "route", url, records, data);
}
__name(eia, "eia");
async function openSky(input, env) {
  requireCredentials("opensky_research", env);
  const tokenUrl = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
  const token = await jsonFetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.OPENSKY_CLIENT_ID, client_secret: env.OPENSKY_CLIENT_SECRET }).toString()
  });
  const accessToken = token?.data?.access_token;
  if (!accessToken) throw new GeoAdapterError("OpenSky OAuth did not return an access token", 502, "provider_auth_error");
  const url = new URL("https://opensky-network.org/api/states/all");
  if (input?.bbox) {
    const [lamin, lomin, lamax, lomax] = String(input.bbox).split(",").map(Number);
    [lamin, lamax].forEach((value) => finite(value, "latitude", { min: -90, max: 90 }));
    [lomin, lomax].forEach((value) => finite(value, "longitude", { min: -180, max: 180 }));
    url.searchParams.set("lamin", String(lamin));
    url.searchParams.set("lomin", String(lomin));
    url.searchParams.set("lamax", String(lamax));
    url.searchParams.set("lomax", String(lomax));
  }
  const { data } = await jsonFetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const records = clampRows(data?.states).map((state) => record("entity", {
    external_id: String(state?.[0] || crypto.randomUUID()),
    entity_type: "aircraft",
    name: String(state?.[1] || state?.[0] || "Aircraft").trim(),
    point: point(state?.[6], state?.[5]),
    observed_at: timestamp(state?.[4] || data?.time),
    properties: {
      icao24: state?.[0],
      callsign: state?.[1],
      origin_country: state?.[2],
      time_position: state?.[3],
      last_contact: state?.[4],
      longitude: state?.[5],
      latitude: state?.[6],
      baro_altitude: state?.[7],
      on_ground: state?.[8],
      velocity: state?.[9],
      true_track: state?.[10],
      vertical_rate: state?.[11],
      sensors: state?.[12],
      geo_altitude: state?.[13],
      squawk: state?.[14],
      spi: state?.[15],
      position_source: state?.[16],
      category: state?.[17]
    }
  }));
  return result("opensky_research", "states", url, records, data);
}
__name(openSky, "openSky");
async function nasaFirms(input, env) {
  requireCredentials("nasa_firms", env);
  const source2 = stringValue(input?.satellite || "VIIRS_SNPP_NRT", "satellite", { max: 40, pattern: /^[A-Za-z0-9_-]+$/ });
  const dayRange = integer(input?.day_range ?? 1, "day_range", { min: 1, max: 10 });
  let area = input?.area;
  if (!area) {
    const { lat, lon } = latLon(input);
    const delta = finite(input?.delta_deg ?? 1, "delta_deg", { min: 0.01, max: 20 });
    area = `${Math.max(-180, lon - delta)},${Math.max(-90, lat - delta)},${Math.min(180, lon + delta)},${Math.min(90, lat + delta)}`;
  }
  const safeArea = stringValue(area, "area", { max: 120, pattern: /^-?[0-9.]+,-?[0-9.]+,-?[0-9.]+,-?[0-9.]+$/ });
  const url = new URL(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(env.FIRMS_MAP_KEY)}/${source2}/${safeArea}/${dayRange}`);
  const response = await providerFetch(url, { headers: { accept: "text/csv" } });
  const text2 = await response.text();
  const rows = parseCsv(text2);
  const records = clampRows(rows).map((fire, index) => record("event", {
    external_id: `firms:${source2}:${fire.latitude}:${fire.longitude}:${fire.acq_date}:${fire.acq_time}:${index}`,
    event_type: "active_fire",
    name: "Active fire / thermal anomaly",
    point: point(fire.latitude, fire.longitude),
    severity: Number.isFinite(Number(fire.frp)) ? Number(fire.frp) : null,
    observed_at: fire.acq_date ? timestamp(`${fire.acq_date}T${String(fire.acq_time || "0000").padStart(4, "0").slice(0, 2)}:${String(fire.acq_time || "0000").padStart(4, "0").slice(2, 4)}:00Z`) : (/* @__PURE__ */ new Date()).toISOString(),
    properties: fire
  }));
  return result("nasa_firms", "area", url, records, rows);
}
__name(nasaFirms, "nasaFirms");
async function tomTom(input, env) {
  requireCredentials("tomtom", env);
  const { lat, lon } = latLon(input);
  const zoom = integer(input?.zoom ?? 10, "zoom", { min: 0, max: 22 });
  const style = ["absolute", "relative", "relative0", "relative0-dark", "relative-delay", "reduced-sensitivity"].includes(input?.style) ? input.style : "relative";
  const url = new URL(`https://api.tomtom.com/traffic/services/4/flowSegmentData/${style}/${zoom}/json`);
  url.searchParams.set("point", `${lat},${lon}`);
  url.searchParams.set("key", env.TOMTOM_API_KEY);
  const { data } = await jsonFetch(url);
  const flow = data?.flowSegmentData || data || {};
  const recordRow = record("observation", {
    external_id: `tomtom:flow:${lat.toFixed(5)},${lon.toFixed(5)}:${Math.floor(Date.now() / 12e4)}`,
    observation_type: "traffic_flow",
    metric: "current_speed",
    value_number: Number.isFinite(Number(flow?.currentSpeed)) ? Number(flow.currentSpeed) : null,
    unit: flow?.unit || "km/h",
    point: point(lat, lon),
    observed_at: (/* @__PURE__ */ new Date()).toISOString(),
    properties: flow || {}
  });
  return result("tomtom", "flow_segment", url, [recordRow], data);
}
__name(tomTom, "tomTom");
async function mapbox(input, env) {
  requireCredentials("mapbox", env);
  const query = encodeURIComponent(stringValue(input?.query, "query", { max: 300 }));
  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json`);
  url.searchParams.set("access_token", env.MAPBOX_ACCESS_TOKEN);
  url.searchParams.set("limit", String(integer(input?.limit ?? 5, "limit", { min: 1, max: 10 })));
  const { data } = await jsonFetch(url);
  const records = clampRows(data?.features).map((feature) => record("entity", {
    external_id: String(feature?.id || crypto.randomUUID()),
    entity_type: "geocode_result",
    name: feature?.place_name || feature?.text || "Place",
    point: point(feature?.center?.[1], feature?.center?.[0]),
    observed_at: (/* @__PURE__ */ new Date()).toISOString(),
    properties: feature || {}
  }));
  return result("mapbox", "geocode", url, records, data);
}
__name(mapbox, "mapbox");
async function googleMaps(input, env) {
  requireCredentials("google_maps", env);
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  if (input?.address) url.searchParams.set("address", stringValue(input.address, "address", { max: 500 }));
  else {
    const { lat, lon } = latLon(input);
    url.searchParams.set("latlng", `${lat},${lon}`);
  }
  url.searchParams.set("key", env.GOOGLE_MAPS_API_KEY);
  const { data } = await jsonFetch(url);
  const records = clampRows(data?.results).map((item) => record("entity", {
    external_id: String(item?.place_id || crypto.randomUUID()),
    entity_type: "geocode_result",
    name: item?.formatted_address || "Place",
    point: point(item?.geometry?.location?.lat, item?.geometry?.location?.lng),
    observed_at: (/* @__PURE__ */ new Date()).toISOString(),
    properties: item || {}
  }));
  return result("google_maps", "geocode", url, records, data);
}
__name(googleMaps, "googleMaps");
async function nominatim(input) {
  const { lat, lon } = latLon(input);
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", String(integer(input?.zoom ?? 14, "zoom", { min: 3, max: 18 })));
  const { data } = await jsonFetch(url, { headers: { "accept-language": "en" } });
  const records = [record("entity", {
    external_id: String(data?.place_id || `nominatim:${lat},${lon}`),
    entity_type: "place",
    name: data?.display_name || "Place",
    point: point(data?.lat ?? lat, data?.lon ?? lon),
    observed_at: (/* @__PURE__ */ new Date()).toISOString(),
    properties: data || {}
  })];
  return result("nominatim", "reverse", url, records, data);
}
__name(nominatim, "nominatim");
async function gdelt(input) {
  const query = stringValue(input?.query, "query", { max: 300 });
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", String(integer(input?.limit ?? 25, "limit", { min: 1, max: 250 })));
  url.searchParams.set("sort", "HybridRel");
  const { data } = await jsonFetch(url);
  const contextPoint = input?.lat !== void 0 ? point(input.lat, input.lon ?? input.lng) : null;
  const records = clampRows(data?.articles).map((article, index) => record("event", {
    external_id: String(article?.url || `gdelt:${index}:${article?.seendate || ""}`),
    event_type: "news_article",
    name: article?.title || "News article",
    point: contextPoint,
    observed_at: timestamp(article?.seendate),
    source_url: article?.url || null,
    properties: article || {}
  }));
  return result("gdelt", "articles", url, records, data);
}
__name(gdelt, "gdelt");
async function radioBrowser(input) {
  const url = new URL("https://all.api.radio-browser.info/json/stations/search");
  url.searchParams.set("hidebroken", "true");
  url.searchParams.set("order", "clickcount");
  url.searchParams.set("reverse", "true");
  url.searchParams.set("limit", String(integer(input?.limit ?? 100, "limit", { min: 1, max: 500 })));
  if (input?.countrycode) url.searchParams.set("countrycode", stringValue(input.countrycode, "countrycode", { max: 2, pattern: /^[A-Za-z]{2}$/ }).toUpperCase());
  if (input?.tag) url.searchParams.set("tag", stringValue(input.tag, "tag", { max: 80 }));
  const { data } = await jsonFetch(url);
  const records = clampRows(data).map((station) => record("entity", {
    external_id: String(station?.stationuuid || crypto.randomUUID()),
    entity_type: "radio_station",
    name: station?.name || "Radio station",
    point: point(station?.geo_lat ?? station?.latitude, station?.geo_long ?? station?.longitude),
    observed_at: (/* @__PURE__ */ new Date()).toISOString(),
    source_url: station?.homepage || null,
    properties: { ...station, url: void 0, url_resolved: void 0 }
  }));
  return result("radio_browser", "stations", url, records, data);
}
__name(radioBrowser, "radioBrowser");
async function gbfs(input) {
  const url = assertPublicHttpsUrl(input?.url);
  const { data } = await jsonFetch(url);
  const stations = data?.data?.stations || data?.data?.bikes || data?.data?.vehicles || [];
  const records = clampRows(stations).map((item, index) => record("entity", {
    external_id: String(item?.station_id || item?.vehicle_id || item?.bike_id || index),
    entity_type: item?.station_id ? "bikeshare_station" : "shared_mobility_vehicle",
    name: item?.name || item?.station_id || item?.vehicle_id || "Shared mobility",
    point: point(item?.lat, item?.lon),
    observed_at: timestamp(data?.last_updated),
    properties: item || {}
  }));
  return result("gbfs", "feed", url, records, data);
}
__name(gbfs, "gbfs");
async function cctv(input) {
  const provider = input?.provider || "austin";
  if (provider !== "austin") throw new GeoAdapterError("Only the audited Austin CCTV catalog is enabled in this adapter", 400, "unsupported_provider");
  const url = new URL("https://data.austintexas.gov/api/views/b4k4-adkb/rows.json?accessType=DOWNLOAD");
  const { data } = await jsonFetch(url);
  return result("cctv", "catalog", url, [], data, { note: "Catalog is returned transiently; camera-frame redistribution remains provider-governed." });
}
__name(cctv, "cctv");
async function copernicus(input, env) {
  requireCredentials("copernicus", env);
  const tokenUrl = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
  const token = await jsonFetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.COPERNICUS_CLIENT_ID, client_secret: env.COPERNICUS_CLIENT_SECRET }).toString()
  });
  const accessToken = token?.data?.access_token;
  if (!accessToken) throw new GeoAdapterError("Copernicus OAuth did not return an access token", 502, "provider_auth_error");
  const url = new URL("https://catalogue.dataspace.copernicus.eu/stac/search");
  const body = {
    collections: input?.collections || ["SENTINEL-2"],
    limit: integer(input?.limit ?? 50, "limit", { min: 1, max: 100 }),
    ...input?.bbox ? { bbox: String(input.bbox).split(",").map(Number) } : {},
    ...input?.datetime ? { datetime: String(input.datetime) } : {}
  };
  const { data } = await jsonFetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` }, body: JSON.stringify(body) });
  const records = clampRows(data?.features).map((feature) => {
    let p = null;
    if (feature?.geometry?.type === "Point") p = point(feature.geometry.coordinates?.[1], feature.geometry.coordinates?.[0]);
    else if (Array.isArray(feature?.bbox) && feature.bbox.length >= 4) p = point((feature.bbox[1] + feature.bbox[3]) / 2, (feature.bbox[0] + feature.bbox[2]) / 2);
    return record("entity", {
      external_id: String(feature?.id || crypto.randomUUID()),
      entity_type: "earth_observation_scene",
      name: feature?.properties?.title || feature?.id || "Copernicus scene",
      point: p,
      observed_at: timestamp(feature?.properties?.datetime),
      properties: { type: feature?.type, bbox: feature?.bbox, geometry: feature?.geometry, properties: feature?.properties, assets: feature?.assets }
    });
  });
  return result("copernicus", "stac_search", url, records, data);
}
__name(copernicus, "copernicus");
async function planet(input, env) {
  requireCredentials("planet_research", env);
  const url = new URL("https://api.planet.com/data/v1/quick-search");
  const body = {
    item_types: input?.item_types || ["PSScene"],
    filter: input?.filter || {
      type: "AndFilter",
      config: [
        ...input?.geometry ? [{ type: "GeometryFilter", field_name: "geometry", config: input.geometry }] : [],
        { type: "DateRangeFilter", field_name: "acquired", config: { gte: input?.start_time || new Date(Date.now() - 7 * 864e5).toISOString(), lte: input?.end_time || (/* @__PURE__ */ new Date()).toISOString() } }
      ]
    }
  };
  const auth = btoa(`${env.PLANET_RESEARCH_API_KEY}:`);
  const { data } = await jsonFetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Basic ${auth}` }, body: JSON.stringify(body) });
  const records = clampRows(data?.features).map((feature) => {
    const coords = feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null;
    return record("entity", {
      external_id: String(feature?.id || crypto.randomUUID()),
      entity_type: "earth_observation_scene",
      name: feature?.id || "Planet scene",
      point: coords ? point(coords[1], coords[0]) : null,
      observed_at: timestamp(feature?.properties?.acquired),
      properties: feature || {}
    });
  });
  return result("planet_research", "quick_search", url, records, data);
}
__name(planet, "planet");
async function passthroughConfig(sourceKey) {
  const source2 = sourceByKey(sourceKey);
  if (sourceKey === "reearth_terrain") {
    return result(sourceKey, "config", null, [], null, {
      tilejson_url: "https://tiles.mapterhorn.com/layer.json",
      tile_url_template: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp",
      encoding: "terrarium",
      tile_size: 512,
      quantized_mesh: false,
      note: "Raster terrarium DEM. Cesium needs a quantized-mesh terrain provider or a client-side terrarium decoder; it is not a drop-in TerrainProvider URL."
    });
  }
  if (sourceKey === "cesium_ion") {
    return result(sourceKey, "config", null, [], null, { configured_for_server: true, note: "Viewer token remains a scoped client/viewer concern; this endpoint never returns it." });
  }
  throw new GeoAdapterError(`${source2?.name || sourceKey} has no one-shot HTTP operation`, 400, "unsupported_operation");
}
__name(passthroughConfig, "passthroughConfig");
async function executeAdapter(sourceKey, input = {}, env = {}) {
  const source2 = sourceByKey(sourceKey);
  if (!source2) throw new GeoAdapterError("Unknown spatial source", 404, "unknown_source");
  if (source2.credentialEnv.length && !sourceConfigured(source2, env)) requireCredentials(sourceKey, env);
  switch (sourceKey) {
    case "usgs":
      return usgs(input);
    case "open_meteo":
      return openMeteo(input);
    case "celestrak":
      return celestrak(input);
    case "adsb_lol":
      return adsbLol(input);
    case "overpass":
      return overpass(input);
    case "launch_library2":
      return launchLibrary(input, env);
    case "grants_gov":
      return grantsGov(input);
    case "usaspending":
      return usaSpending(input);
    case "nhtsa":
      return nhtsa(input);
    case "census":
      return census(input, env);
    case "fred":
      return fred(input, env);
    case "bls":
      return bls(input, env);
    case "eia":
      return eia(input, env);
    case "opensky_research":
      return openSky(input, env);
    case "nasa_firms":
      return nasaFirms(input, env);
    case "tomtom":
      return tomTom(input, env);
    case "mapbox":
      return mapbox(input, env);
    case "google_maps":
      return googleMaps(input, env);
    // gateway.js owns these two. They resolve to the providers' current APIs in
    // verified-adapters.js rather than the legacy endpoints upstream GEV used,
    // so reaching them here means a caller bypassed executeProvider.
    case "data_commons":
    case "epa":
      throw new GeoAdapterError(`${source2.name} is served through the verified provider gateway`, 500, "adapter_routing_error");
    case "nominatim":
      return nominatim(input);
    case "gdelt":
      return gdelt(input);
    case "radio_browser":
      return radioBrowser(input);
    case "gbfs":
      return gbfs(input);
    case "cctv":
      return cctv(input);
    case "copernicus":
      return copernicus(input, env);
    case "planet_research":
      return planet(input, env);
    case "reearth_terrain":
    case "cesium_ion":
      return passthroughConfig(sourceKey);
    case "aisstream":
      return result("aisstream", "websocket", null, [], null, { live_endpoint: "/v1/geo/live/ais", configured: sourceConfigured(source2, env) });
    default:
      throw new GeoAdapterError(`${source2.name} adapter is registered but has no default operation`, 501, "adapter_not_implemented");
  }
}
__name(executeAdapter, "executeAdapter");
function adapterCapabilities() {
  return {
    persistent: ["usgs", "open_meteo", "celestrak", "adsb_lol", "overpass", "launch_library2", "grants_gov", "usaspending", "nhtsa", "census", "fred", "bls", "eia", "data_commons", "nasa_firms", "copernicus", "planet_research", "radio_browser", "gbfs"],
    transient: ["opensky_research", "tomtom", "mapbox", "nominatim", "gdelt", "cctv", "aisstream"],
    never_persist: ["google_maps", "cesium_ion"],
    config_only: ["reearth_terrain", "cesium_ion"]
  };
}
__name(adapterCapabilities, "adapterCapabilities");

// src/geo/access.js
init_modules_watch_stub();
var JWKS_TTL_MS = 36e5;
var jwksCache = { url: null, keys: null, fetchedAt: 0 };
var AccessError = class extends Error {
  static {
    __name(this, "AccessError");
  }
  constructor(message, status = 403, code = "access_denied") {
    super(message);
    this.name = "AccessError";
    this.status = status;
    this.code = code;
  }
};
function accessConfigured(env) {
  return Boolean(env?.GEV_ACCESS_TEAM_DOMAIN && env?.GEV_ACCESS_AUD);
}
__name(accessConfigured, "accessConfigured");
function teamOrigin(env) {
  const raw = String(env.GEV_ACCESS_TEAM_DOMAIN).trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const host = raw.includes(".") ? raw : `${raw}.cloudflareaccess.com`;
  if (!/^[a-z0-9.-]+$/i.test(host)) throw new AccessError("Access team domain is malformed", 500, "access_misconfigured");
  return `https://${host}`;
}
__name(teamOrigin, "teamOrigin");
function base64UrlToBytes(value) {
  const padded = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(padded.length + (4 - padded.length % 4) % 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
__name(base64UrlToBytes, "base64UrlToBytes");
function decodeSegment(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}
__name(decodeSegment, "decodeSegment");
async function jwks(env) {
  const url = `${teamOrigin(env)}/cdn-cgi/access/certs`;
  const fresh = jwksCache.url === url && jwksCache.keys && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (fresh) return jwksCache.keys;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new AccessError("Could not load Cloudflare Access signing keys", 503, "access_jwks_unavailable");
  const body = await response.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  if (!keys.length) throw new AccessError("Cloudflare Access returned no signing keys", 503, "access_jwks_unavailable");
  jwksCache = { url, keys, fetchedAt: Date.now() };
  return keys;
}
__name(jwks, "jwks");
function readToken(request) {
  const header = request.headers.get("cf-access-jwt-assertion");
  if (header) return header.trim();
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
__name(readToken, "readToken");
async function verifyAccess(request, env) {
  if (!accessConfigured(env)) return null;
  const token = readToken(request);
  if (!token) throw new AccessError("Cloudflare Access assertion is required", 401, "access_assertion_missing");
  const parts = token.split(".");
  if (parts.length !== 3) throw new AccessError("Cloudflare Access assertion is malformed", 401, "access_assertion_malformed");
  let header;
  let payload;
  try {
    header = decodeSegment(parts[0]);
    payload = decodeSegment(parts[1]);
  } catch {
    throw new AccessError("Cloudflare Access assertion is malformed", 401, "access_assertion_malformed");
  }
  if (header?.alg !== "RS256") throw new AccessError("Unsupported Access assertion algorithm", 401, "access_assertion_alg");
  const now = Math.floor(Date.now() / 1e3);
  if (!payload?.exp || payload.exp <= now) throw new AccessError("Cloudflare Access assertion expired", 401, "access_assertion_expired");
  if (payload.nbf && payload.nbf > now + 60) throw new AccessError("Cloudflare Access assertion is not yet valid", 401, "access_assertion_nbf");
  if (payload.iss !== teamOrigin(env)) throw new AccessError("Cloudflare Access assertion issuer mismatch", 403, "access_assertion_issuer");
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(String(env.GEV_ACCESS_AUD))) {
    throw new AccessError("Cloudflare Access assertion audience mismatch", 403, "access_assertion_audience");
  }
  const candidates = (await jwks(env)).filter((key) => !header.kid || key.kid === header.kid);
  const signature = base64UrlToBytes(parts[2]);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  for (const jwk of candidates) {
    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        { ...jwk, alg: "RS256", ext: true, key_ops: ["verify"] },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      );
      if (await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed)) {
        return { email: payload.email || null, sub: payload.sub || null, aud: env.GEV_ACCESS_AUD, expires_at: payload.exp };
      }
    } catch {
    }
  }
  throw new AccessError("Cloudflare Access assertion signature is invalid", 403, "access_assertion_signature");
}
__name(verifyAccess, "verifyAccess");

// src/geo/entitlements.js
init_modules_watch_stub();
var LANES = Object.freeze({
  PUBLIC_OPEN: "PUBLIC_OPEN",
  ACADEMIC: "ACADEMIC",
  NONPROFIT: "NONPROFIT",
  COMMERCIAL: "COMMERCIAL",
  INTERNAL: "INTERNAL",
  RESTRICTED: "RESTRICTED"
});
var LANE_VALUES = new Set(Object.values(LANES));
var CONSUMABLE_BY = Object.freeze({
  [SOURCE_CLASSES.PUBLIC_OPEN]: [LANES.PUBLIC_OPEN, LANES.ACADEMIC, LANES.NONPROFIT, LANES.COMMERCIAL, LANES.INTERNAL, LANES.RESTRICTED],
  [SOURCE_CLASSES.ACADEMIC]: [LANES.ACADEMIC, LANES.INTERNAL],
  [SOURCE_CLASSES.NONPROFIT]: [LANES.NONPROFIT, LANES.INTERNAL],
  [SOURCE_CLASSES.COMMERCIAL]: [LANES.COMMERCIAL, LANES.INTERNAL],
  [SOURCE_CLASSES.INTERNAL]: [LANES.INTERNAL],
  [SOURCE_CLASSES.RESTRICTED]: [LANES.INTERNAL]
});
function normalizeLane(value, fallback = LANES.INTERNAL) {
  if (value === void 0 || value === null || value === "") return fallback;
  const lane = String(value).trim().toUpperCase();
  if (!LANE_VALUES.has(lane)) {
    throw new GeoAdapterError(`lane must be one of ${[...LANE_VALUES].join(", ")}`, 400, "invalid_lane");
  }
  return lane;
}
__name(normalizeLane, "normalizeLane");
function defaultEntitlement(source2) {
  const open = source2.sourceClass === SOURCE_CLASSES.PUBLIC_OPEN;
  const persistable = source2.persistence === PERSISTENCE.PERSISTENT;
  return {
    source_key: source2.key,
    origin: "registry_default",
    enabled: true,
    lane: source2.lane,
    source_class: source2.sourceClass,
    consumable_by: CONSUMABLE_BY[source2.sourceClass] || [LANES.INTERNAL],
    commercial_use: source2.sourceClass === SOURCE_CLASSES.COMMERCIAL || open,
    public_display: open,
    redistribution: false,
    persistence_allowed: persistable,
    derived_use: true,
    attribution_required: Boolean(source2.attribution),
    attribution: source2.attribution,
    expires_at: null
  };
}
__name(defaultEntitlement, "defaultEntitlement");
function applyRow(base, row) {
  if (!row) return base;
  return {
    ...base,
    origin: "org_entitlement",
    enabled: row.enabled !== false,
    lane: row.lane || base.lane,
    commercial_use: Boolean(row.commercial_use),
    public_display: Boolean(row.public_display),
    redistribution: Boolean(row.redistribution),
    persistence_allowed: Boolean(row.persistence_allowed) && base.persistence_allowed,
    terms_acknowledged_at: row.terms_acknowledged_at || null,
    expires_at: row.expires_at || null
  };
}
__name(applyRow, "applyRow");
function effectiveEntitlement(source2, row) {
  return applyRow(defaultEntitlement(source2), row);
}
__name(effectiveEntitlement, "effectiveEntitlement");
function assertConsumable(entitlement, lane) {
  if (!entitlement.enabled) {
    throw new GeoAdapterError(`${entitlement.source_key} is disabled for this organization`, 403, "entitlement_disabled", {
      source: entitlement.source_key
    });
  }
  if (entitlement.expires_at && Date.parse(entitlement.expires_at) <= Date.now()) {
    throw new GeoAdapterError(`${entitlement.source_key} entitlement expired`, 403, "entitlement_expired", {
      source: entitlement.source_key,
      expires_at: entitlement.expires_at
    });
  }
  if (!entitlement.consumable_by.includes(lane)) {
    throw new GeoAdapterError(
      `${entitlement.source_key} is licensed under ${entitlement.source_class} and cannot be consumed on the ${lane} lane`,
      403,
      "entitlement_lane_denied",
      { source: entitlement.source_key, source_class: entitlement.source_class, requested_lane: lane, consumable_by: entitlement.consumable_by }
    );
  }
  if (lane === LANES.COMMERCIAL && !entitlement.commercial_use) {
    throw new GeoAdapterError(`${entitlement.source_key} does not permit commercial use`, 403, "entitlement_commercial_denied", {
      source: entitlement.source_key
    });
  }
  return entitlement;
}
__name(assertConsumable, "assertConsumable");
function entitlementCatalog(rowsByKey = /* @__PURE__ */ new Map(), lane = LANES.INTERNAL) {
  return (source2) => {
    const entitlement = effectiveEntitlement(source2, rowsByKey.get(source2.key));
    let allowed = true;
    let denied_reason = null;
    try {
      assertConsumable(entitlement, lane);
    } catch (error) {
      allowed = false;
      denied_reason = error.code;
    }
    return { ...entitlement, requested_lane: lane, allowed, denied_reason };
  };
}
__name(entitlementCatalog, "entitlementCatalog");
function sourceOrThrow(key) {
  const source2 = sourceByKey(key);
  if (!source2) throw new GeoAdapterError("Unknown spatial source", 404, "unknown_source");
  return source2;
}
__name(sourceOrThrow, "sourceOrThrow");

// src/geo/gateway.js
init_modules_watch_stub();

// src/geo/verified-adapters.js
init_modules_watch_stub();
var MAX_ROWS = 2e3;
function text(value, name, max = 300) {
  const result2 = String(value || "").trim();
  if (!result2 || result2.length > max) throw new GeoAdapterError(`${name} is invalid`, 400, "invalid_parameter");
  return result2;
}
__name(text, "text");
function finite2(value, name, min, max, fallback = null) {
  if ((value === void 0 || value === null || value === "") && fallback !== null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new GeoAdapterError(`${name} is invalid`, 400, "invalid_parameter");
  return parsed;
}
__name(finite2, "finite");
function timestamp2(date) {
  if (!date) return (/* @__PURE__ */ new Date()).toISOString();
  const normalized = /^\d{4}(-\d{2})?(-\d{2})?$/.test(String(date)) ? `${String(date).padEnd(10, "-01").replace(/-01-01-01$/, "-01-01")}T00:00:00Z` : String(date);
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.valueOf()) ? (/* @__PURE__ */ new Date()).toISOString() : parsed.toISOString();
}
__name(timestamp2, "timestamp");
async function jsonFetch2(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15e3);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "error",
      headers: {
        accept: "application/json",
        "user-agent": "McCluster-Spatial/1.0 (https://mccluster.org)",
        ...init.headers || {}
      }
    });
    const body = await response.text();
    if (!response.ok) {
      throw new GeoAdapterError("Provider request failed", response.status === 429 ? 429 : 502, "provider_error", {
        provider_status: response.status,
        body: body.slice(0, 600)
      });
    }
    try {
      return body ? JSON.parse(body) : null;
    } catch {
      throw new GeoAdapterError("Provider returned invalid JSON", 502, "provider_invalid_json");
    }
  } catch (error) {
    if (error instanceof GeoAdapterError) throw error;
    if (error?.name === "AbortError") throw new GeoAdapterError("Provider request timed out", 504, "provider_timeout");
    throw new GeoAdapterError("Provider request failed", 502, "provider_network_error");
  } finally {
    clearTimeout(timer);
  }
}
__name(jsonFetch2, "jsonFetch");
function baseResult(source2, operation, sourceUrl, records, raw, attribution = null) {
  return {
    source: source2,
    operation,
    fetched_at: (/* @__PURE__ */ new Date()).toISOString(),
    source_url: sourceUrl,
    attribution,
    persistence: "persistent",
    records: records.slice(0, MAX_ROWS),
    raw
  };
}
__name(baseResult, "baseResult");
async function dataCommonsV2(input, env) {
  if (!env?.DATA_COMMONS_API_KEY) {
    throw new GeoAdapterError("Data Commons credentials are not configured", 503, "credential_missing", {
      required_bindings: ["DATA_COMMONS_API_KEY"]
    });
  }
  const variables = Array.isArray(input?.stat_vars) ? input.stat_vars.slice(0, 20).map((value) => text(value, "stat_var")) : [text(input?.stat_var, "stat_var")];
  const entities = Array.isArray(input?.places) ? input.places.slice(0, 50).map((value) => text(value, "place")) : [text(input?.place, "place")];
  const date = input?.date === void 0 ? "" : String(input.date);
  const url = "https://api.datacommons.org/v2/observation";
  const requestBody = {
    date,
    variable: { dcids: variables },
    entity: { dcids: entities },
    select: ["value", "date", "facet"]
  };
  const data = await jsonFetch2(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.DATA_COMMONS_API_KEY
    },
    body: JSON.stringify(requestBody)
  });
  const records = [];
  for (const [variable, variableData] of Object.entries(data?.byVariable || {})) {
    for (const [entity, entityData] of Object.entries(variableData?.byEntity || {})) {
      for (const facet of entityData?.orderedFacets || []) {
        const facetMeta = data?.facets?.[String(facet?.facetId)] || {};
        for (const observation of facet?.observations || []) {
          if (records.length >= MAX_ROWS) break;
          records.push({
            kind: "observation",
            external_id: `dc:${entity}:${variable}:${facet?.facetId || "default"}:${observation?.date}`,
            observation_type: "statistical_series",
            metric: variable,
            value_number: Number.isFinite(Number(observation?.value)) ? Number(observation.value) : null,
            value_text: observation?.value === void 0 ? null : String(observation.value),
            unit: facetMeta?.unit || null,
            point: null,
            observed_at: timestamp2(observation?.date),
            properties: {
              entity,
              facet_id: facet?.facetId || null,
              facet: facetMeta
            }
          });
        }
      }
    }
  }
  return baseResult("data_commons", "v2_observation", url, records, data, "Data Commons");
}
__name(dataCommonsV2, "dataCommonsV2");
async function epaEchoFacilities(input) {
  const url = new URL("https://echodata.epa.gov/echo/echo_rest_services.get_facilities");
  url.searchParams.set("output", "JSON");
  url.searchParams.set("responseset", String(Math.max(1, Math.min(Math.trunc(Number(input?.limit || 100)), 1e3))));
  const allowedConvenience = {
    facility_name: "p_fn",
    state: "p_st",
    city: "p_ct",
    zip: "p_zip",
    media: "p_med"
  };
  for (const [inputKey, echoKey] of Object.entries(allowedConvenience)) {
    if (input?.[inputKey] !== void 0 && input?.[inputKey] !== null && input?.[inputKey] !== "") {
      url.searchParams.set(echoKey, String(input[inputKey]).slice(0, 200));
    }
  }
  if (input?.lat !== void 0 || input?.latitude !== void 0) {
    url.searchParams.set("p_lat", String(finite2(input?.lat ?? input?.latitude, "lat", -90, 90)));
    url.searchParams.set("p_long", String(finite2(input?.lon ?? input?.lng ?? input?.longitude, "lon", -180, 180)));
    url.searchParams.set("p_radius", String(finite2(input?.radius_miles ?? input?.radius ?? 25, "radius_miles", 0.1, 100)));
  }
  for (const [key, value] of Object.entries(input?.params || {})) {
    if (!/^p_[A-Za-z0-9_]+$/.test(key)) continue;
    if (!["string", "number", "boolean"].includes(typeof value)) continue;
    url.searchParams.set(key, String(value).slice(0, 300));
  }
  const data = await jsonFetch2(url);
  const facilities = data?.Results?.Facilities || data?.Results?.Facility || data?.Results?.FacilitiesList || [];
  const rows = Array.isArray(facilities) ? facilities : [];
  const records = rows.slice(0, MAX_ROWS).map((facility, index) => {
    const lat = Number(facility?.FacLat ?? facility?.Latitude ?? facility?.AIRLat ?? facility?.Lat);
    const lon = Number(facility?.FacLong ?? facility?.Longitude ?? facility?.AIRLong ?? facility?.Long);
    return {
      kind: "entity",
      external_id: String(facility?.RegistryID || facility?.RegistryId || facility?.FacID || facility?.SourceID || index),
      entity_type: "regulated_facility",
      name: facility?.FacName || facility?.FacilityName || facility?.Name || "EPA regulated facility",
      point: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null,
      observed_at: (/* @__PURE__ */ new Date()).toISOString(),
      properties: facility || {}
    };
  });
  return baseResult("epa", "echo_facilities", url.toString(), records, data, "U.S. EPA ECHO");
}
__name(epaEchoFacilities, "epaEchoFacilities");

// src/geo/gateway.js
async function executeProvider(sourceKey, input = {}, env = {}) {
  if (sourceKey === "data_commons") return dataCommonsV2(input, env);
  if (sourceKey === "epa") return epaEchoFacilities(input, env);
  return executeAdapter(sourceKey, input, env);
}
__name(executeProvider, "executeProvider");

// src/geo/store.js
init_modules_watch_stub();
function configured(env) {
  return Boolean(env?.SUPABASE_URL && env?.SUPABASE_SERVICE_ROLE_KEY);
}
__name(configured, "configured");
function headers(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
    ...extra
  };
}
__name(headers, "headers");
async function db(env, path, { method = "GET", body, prefer, allow404 = false } = {}) {
  if (!configured(env)) throw new GeoAdapterError("McCluster database is not configured", 503, "database_not_configured");
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: headers(env, prefer ? { prefer } : {}),
    body: body === void 0 ? void 0 : JSON.stringify(body)
  });
  if (allow404 && response.status === 404) return null;
  const text2 = await response.text();
  let payload = null;
  try {
    payload = text2 ? JSON.parse(text2) : null;
  } catch {
    payload = text2;
  }
  if (!response.ok) {
    throw new GeoAdapterError("Spatial database request failed", response.status === 404 ? 503 : 502, "database_error", {
      status: response.status,
      payload
    });
  }
  return payload;
}
__name(db, "db");
async function resolveHouseOrg(env) {
  const rows = await db(env, "orgs?slug=eq.mccluster&enabled=eq.true&select=id,slug,name,kind&limit=1");
  const org = rows?.[0];
  if (!org) throw new GeoAdapterError("McCluster house organization is not configured", 503, "house_org_missing");
  return org;
}
__name(resolveHouseOrg, "resolveHouseOrg");
async function schemaReady(env) {
  if (!configured(env)) return false;
  try {
    const rows = await db(env, "geo_sources?select=source_key&limit=1");
    return Array.isArray(rows);
  } catch {
    return false;
  }
}
__name(schemaReady, "schemaReady");
function wktPoint(value) {
  if (!value || !Number.isFinite(Number(value.lat)) || !Number.isFinite(Number(value.lon))) return null;
  return `POINT(${Number(value.lon)} ${Number(value.lat)})`;
}
__name(wktPoint, "wktPoint");
function provenance(result2, record2) {
  return {
    provider: result2.source,
    fetched_at: result2.fetched_at,
    source_url: record2?.source_url || result2.source_url || null,
    attribution: result2.attribution || null,
    persistence_policy: result2.persistence
  };
}
__name(provenance, "provenance");
function entityRow(orgId, result2, item) {
  return {
    org_id: orgId,
    source_key: result2.source,
    external_id: String(item.external_id),
    entity_type: item.entity_type || "unknown",
    name: item.name || null,
    location: wktPoint(item.point),
    properties: item.properties || {},
    provenance: provenance(result2, item),
    source_url: item.source_url || result2.source_url || null,
    observed_at: item.observed_at || result2.fetched_at,
    last_seen_at: result2.fetched_at,
    updated_at: result2.fetched_at
  };
}
__name(entityRow, "entityRow");
function eventRow(orgId, result2, item) {
  return {
    org_id: orgId,
    source_key: result2.source,
    external_id: String(item.external_id),
    event_type: item.event_type || "unknown",
    name: item.name || null,
    location: wktPoint(item.point),
    severity: Number.isFinite(Number(item.severity)) ? Number(item.severity) : null,
    status: item.status || null,
    starts_at: item.starts_at || null,
    ends_at: item.ends_at || null,
    observed_at: item.observed_at || result2.fetched_at,
    properties: item.properties || {},
    provenance: provenance(result2, item),
    source_url: item.source_url || result2.source_url || null,
    updated_at: result2.fetched_at
  };
}
__name(eventRow, "eventRow");
function observationRow(orgId, result2, item) {
  return {
    org_id: orgId,
    source_key: result2.source,
    external_id: item.external_id ? String(item.external_id) : null,
    observation_type: item.observation_type || "measurement",
    metric: item.metric || null,
    value_number: Number.isFinite(Number(item.value_number)) ? Number(item.value_number) : null,
    value_text: item.value_text === void 0 || item.value_text === null ? null : String(item.value_text),
    unit: item.unit || null,
    location: wktPoint(item.point),
    observed_at: item.observed_at || result2.fetched_at,
    payload: item.properties || {},
    provenance: provenance(result2, item)
  };
}
__name(observationRow, "observationRow");
async function startRun(env, orgId, result2, operation, requestFingerprint2 = null) {
  const rows = await db(env, "geo_ingestion_runs", {
    method: "POST",
    prefer: "return=representation",
    body: [{
      org_id: orgId,
      source_key: result2.source,
      operation,
      status: "running",
      request_fingerprint: requestFingerprint2,
      records_seen: result2.records?.length || 0,
      metadata: { source_url: result2.source_url, persistence: result2.persistence }
    }]
  });
  return rows?.[0] || null;
}
__name(startRun, "startRun");
async function finishRun(env, runId, patch3) {
  if (!runId) return;
  await db(env, `geo_ingestion_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: { ...patch3, finished_at: (/* @__PURE__ */ new Date()).toISOString() }
  });
}
__name(finishRun, "finishRun");
async function upsertRows(env, table, rows, onConflict) {
  if (!rows.length) return [];
  return db(env, `${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=representation",
    body: rows
  });
}
__name(upsertRows, "upsertRows");
async function insertObservations(env, rows) {
  if (!rows.length) return [];
  return db(env, "geo_observations?on_conflict=org_id,source_key,external_id", {
    method: "POST",
    prefer: "resolution=ignore-duplicates,return=representation",
    body: rows
  });
}
__name(insertObservations, "insertObservations");
async function persistAdapterResult(env, orgId, result2, { operation = "fetch", requestFingerprint: requestFingerprint2 = null, force = false, entitlement = null } = {}) {
  const source2 = sourceByKey(result2.source);
  if (!source2) throw new GeoAdapterError("Unknown spatial source", 404, "unknown_source");
  if (source2.persistence === PERSISTENCE.NONE) {
    return { persisted: false, reason: "provider_content_must_not_be_stored", records_seen: result2.records?.length || 0, records_written: 0 };
  }
  if (source2.persistence === PERSISTENCE.TRANSIENT && !force) {
    return { persisted: false, reason: "transient_provider", records_seen: result2.records?.length || 0, records_written: 0 };
  }
  if (entitlement && entitlement.persistence_allowed === false) {
    return { persisted: false, reason: "entitlement_forbids_persistence", records_seen: result2.records?.length || 0, records_written: 0 };
  }
  if (!await schemaReady(env)) throw new GeoAdapterError("Spatial database schema is not ready", 503, "spatial_schema_not_ready");
  const run = await startRun(env, orgId, result2, operation, requestFingerprint2);
  try {
    const entities = (result2.records || []).filter((item) => item.kind === "entity").map((item) => entityRow(orgId, result2, item));
    const events = (result2.records || []).filter((item) => item.kind === "event").map((item) => eventRow(orgId, result2, item));
    const observations = (result2.records || []).filter((item) => item.kind === "observation").map((item) => observationRow(orgId, result2, item));
    const [entityWrites, eventWrites, observationWrites] = await Promise.all([
      upsertRows(env, "geo_entities", entities, "org_id,source_key,external_id"),
      upsertRows(env, "geo_events", events, "org_id,source_key,external_id"),
      insertObservations(env, observations)
    ]);
    const written = (entityWrites?.length || 0) + (eventWrites?.length || 0) + (observationWrites?.length || 0);
    await finishRun(env, run?.id, { status: "succeeded", records_written: written });
    return {
      persisted: true,
      ingestion_run_id: run?.id || null,
      records_seen: result2.records?.length || 0,
      records_written: written,
      entities_written: entityWrites?.length || 0,
      events_written: eventWrites?.length || 0,
      observations_written: observationWrites?.length || 0
    };
  } catch (error) {
    await finishRun(env, run?.id, {
      status: "failed",
      records_written: 0,
      error_code: error?.code || "database_error",
      error_message: String(error?.message || error).slice(0, 500)
    }).catch(() => {
    });
    throw error;
  }
}
__name(persistAdapterResult, "persistAdapterResult");
async function rpc(env, name, args) {
  return db(env, `rpc/${name}`, {
    method: "POST",
    prefer: "return=representation",
    body: args
  });
}
__name(rpc, "rpc");
async function nearbyEntities(env, orgId, params) {
  return rpc(env, "geo_nearby", {
    p_org: orgId,
    p_lat: Number(params.lat),
    p_lon: Number(params.lon),
    p_radius_m: Number(params.radius_m || 5e3),
    p_limit: Number(params.limit || 100),
    p_source: params.source || null,
    p_entity_type: params.entity_type || null
  });
}
__name(nearbyEntities, "nearbyEntities");
async function nearbyEvents(env, orgId, params) {
  return rpc(env, "geo_events_nearby", {
    p_org: orgId,
    p_lat: Number(params.lat),
    p_lon: Number(params.lon),
    p_radius_m: Number(params.radius_m || 25e3),
    p_limit: Number(params.limit || 100),
    p_source: params.source || null,
    p_event_type: params.event_type || null
  });
}
__name(nearbyEvents, "nearbyEvents");
async function entitiesInBbox(env, orgId, params) {
  return rpc(env, "geo_bbox", {
    p_org: orgId,
    p_min_lat: Number(params.min_lat),
    p_min_lon: Number(params.min_lon),
    p_max_lat: Number(params.max_lat),
    p_max_lon: Number(params.max_lon),
    p_limit: Number(params.limit || 500),
    p_source: params.source || null
  });
}
__name(entitiesInBbox, "entitiesInBbox");
async function getEntity(env, orgId, id) {
  const rows = await db(env, `geo_entities?org_id=eq.${encodeURIComponent(orgId)}&id=eq.${encodeURIComponent(id)}&select=id,source_key,external_id,entity_type,name,properties,provenance,source_url,observed_at,first_seen_at,last_seen_at,expires_at&limit=1`);
  return rows?.[0] || null;
}
__name(getEntity, "getEntity");
async function listEntities(env, orgId, { source: source2, entityType, limit = 100 } = {}) {
  const parts = [
    `org_id=eq.${encodeURIComponent(orgId)}`,
    "select=id,source_key,external_id,entity_type,name,properties,provenance,source_url,observed_at,first_seen_at,last_seen_at,expires_at",
    "order=last_seen_at.desc",
    `limit=${Math.max(1, Math.min(Number(limit) || 100, 1e3))}`
  ];
  if (source2) parts.push(`source_key=eq.${encodeURIComponent(source2)}`);
  if (entityType) parts.push(`entity_type=eq.${encodeURIComponent(entityType)}`);
  return db(env, `geo_entities?${parts.join("&")}`);
}
__name(listEntities, "listEntities");
async function listIngestionRuns(env, orgId, { source: source2, limit = 50 } = {}) {
  const parts = [
    `org_id=eq.${encodeURIComponent(orgId)}`,
    "select=id,source_key,operation,status,records_seen,records_written,error_code,error_message,started_at,finished_at",
    "order=started_at.desc",
    `limit=${Math.max(1, Math.min(Number(limit) || 50, 200))}`
  ];
  if (source2) parts.push(`source_key=eq.${encodeURIComponent(source2)}`);
  return db(env, `geo_ingestion_runs?${parts.join("&")}`);
}
__name(listIngestionRuns, "listIngestionRuns");
async function entitlementRows(env, orgId, sourceKey = null) {
  if (!configured(env)) return /* @__PURE__ */ new Map();
  const parts = [
    `org_id=eq.${encodeURIComponent(orgId)}`,
    "select=source_key,enabled,lane,commercial_use,public_display,redistribution,persistence_allowed,terms_acknowledged_at,effective_at,expires_at"
  ];
  if (sourceKey) parts.push(`source_key=eq.${encodeURIComponent(sourceKey)}`);
  try {
    const rows = await db(env, `geo_source_entitlements?${parts.join("&")}`);
    return new Map((rows || []).map((row) => [row.source_key, row]));
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
__name(entitlementRows, "entitlementRows");
async function entityRevisions(env, orgId, entityId, limit = 100) {
  return db(env, `geo_entity_revisions?org_id=eq.${encodeURIComponent(orgId)}&entity_id=eq.${encodeURIComponent(entityId)}&select=id,revision,change_type,name,entity_type,properties,provenance,source_url,observed_at,recorded_at&order=revision.desc&limit=${Math.max(1, Math.min(Number(limit) || 100, 500))}`);
}
__name(entityRevisions, "entityRevisions");
async function entityObservations(env, orgId, entityId, limit = 200) {
  return db(env, `geo_observations?org_id=eq.${encodeURIComponent(orgId)}&entity_id=eq.${encodeURIComponent(entityId)}&select=id,source_key,external_id,observation_type,metric,value_number,value_text,unit,observed_at,provenance&order=observed_at.desc&limit=${Math.max(1, Math.min(Number(limit) || 200, 1e3))}`);
}
__name(entityObservations, "entityObservations");
async function timelineNearby(env, orgId, params) {
  return rpc(env, "geo_timeline", {
    p_org: orgId,
    p_lat: Number(params.lat),
    p_lon: Number(params.lon),
    p_radius_m: Number(params.radius_m || 25e3),
    p_from: params.from || null,
    p_to: params.to || null,
    p_limit: Number(params.limit || 200),
    p_source: params.source || null
  });
}
__name(timelineNearby, "timelineNearby");
async function listProjects(env, orgId, limit = 100) {
  return db(env, `geo_projects?org_id=eq.${encodeURIComponent(orgId)}&select=id,project_key,name,description,settings,created_at,updated_at&order=created_at.desc&limit=${Math.max(1, Math.min(Number(limit) || 100, 200))}`);
}
__name(listProjects, "listProjects");
async function listLayers(env, orgId, limit = 200) {
  return db(env, `geo_layers?org_id=eq.${encodeURIComponent(orgId)}&select=id,layer_key,name,source_key,layer_type,enabled,style,settings&order=layer_key.asc&limit=${Math.max(1, Math.min(Number(limit) || 200, 500))}`);
}
__name(listLayers, "listLayers");

// src/geo/index.js
var SERVICE = "mccluster-spatial-intelligence";
var UPSTREAM = "https://github.com/bilawalsidhu/gods-eye-view";
var UPSTREAM_COMMIT = "759652207fd1279ece97f0f19af566feb9a82146";
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function readiness(env) {
  const sources = sourceCatalog(env);
  const credentialed = sources.filter((source2) => source2.credential_required);
  const configured5 = credentialed.filter((source2) => source2.configured);
  const noCredential = sources.filter((source2) => !source2.credential_required);
  return {
    total_sources: sources.length,
    no_credential_sources: noCredential.length,
    credentialed_sources: credentialed.length,
    credentialed_sources_configured: configured5.length,
    credentialed_sources_pending: credentialed.length - configured5.length,
    pending_bindings: credentialed.filter((source2) => !source2.configured).flatMap((source2) => source2.credential_bindings)
  };
}
__name(readiness, "readiness");
function finite3(value, name, min, max, fallback = void 0) {
  if ((value === void 0 || value === null || value === "") && fallback !== void 0) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new GeoAdapterError(`${name} must be between ${min} and ${max}`, 400, "invalid_parameter");
  }
  return parsed;
}
__name(finite3, "finite");
function int(value, name, min, max, fallback) {
  if (value === void 0 || value === null || value === "") return fallback;
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new GeoAdapterError(`${name} must be an integer between ${min} and ${max}`, 400, "invalid_parameter");
  }
  return parsed;
}
__name(int, "int");
function isoOrNull(value, name) {
  if (value === void 0 || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.valueOf())) throw new GeoAdapterError(`${name} must be an ISO timestamp`, 400, "invalid_parameter");
  return parsed.toISOString();
}
__name(isoOrNull, "isoOrNull");
async function jsonBody(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 1e6) throw new GeoAdapterError("Spatial request body is too large", 413, "request_too_large");
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not object");
    return body;
  } catch {
    throw new GeoAdapterError("Request body must be a JSON object", 400, "invalid_json");
  }
}
__name(jsonBody, "jsonBody");
async function requireOwner(request, env, options) {
  if (typeof options?.requireHouseOwner !== "function") {
    throw new GeoAdapterError("Spatial authorization is unavailable", 503, "authorization_unavailable");
  }
  return options.requireHouseOwner(request, env);
}
__name(requireOwner, "requireOwner");
async function protectedContext(request, env, options, { requireSchema = false, lane = null } = {}) {
  const access = await verifyAccess(request, env);
  const user4 = await requireOwner(request, env, options);
  const org = await resolveHouseOrg(env);
  if (requireSchema && !await schemaReady(env)) {
    throw new GeoAdapterError("Spatial database schema is not ready", 503, "spatial_schema_not_ready");
  }
  return { access, user: user4, org, lane: lane === null ? null : normalizeLane(lane) };
}
__name(protectedContext, "protectedContext");
async function requestFingerprint(source2, body) {
  const bytes = new TextEncoder().encode(JSON.stringify({ source: source2, body }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
__name(requestFingerprint, "requestFingerprint");
function responseResult(result2, { includeRaw = false, persistence = null, entitlement = null } = {}) {
  const payload = {
    source: result2.source,
    operation: result2.operation,
    fetched_at: result2.fetched_at,
    source_url: result2.source_url,
    attribution: result2.attribution,
    persistence_policy: result2.persistence,
    records: result2.records || [],
    persistence,
    entitlement
  };
  for (const [key, value] of Object.entries(result2)) {
    if (["source", "operation", "fetched_at", "source_url", "attribution", "persistence", "records", "raw"].includes(key)) continue;
    payload[key] = value;
  }
  if (includeRaw) payload.raw = result2.raw;
  return payload;
}
__name(responseResult, "responseResult");
async function fetchAndMaybePersist(request, env, options, sourceKey, mode) {
  const source2 = sourceOrThrow(sourceKey);
  const body = await jsonBody(request);
  const lane = normalizeLane(body.lane);
  const { org } = await protectedContext(request, env, options);
  const rows = await entitlementRows(env, org.id, sourceKey);
  const entitlement = effectiveEntitlement(source2, rows.get(sourceKey));
  assertConsumable(entitlement, lane);
  const result2 = await executeProvider(sourceKey, body, env);
  const shouldPersist = mode === "ingest" || body.persist !== false;
  let persistence = {
    persisted: false,
    reason: shouldPersist ? "not_persistable" : "disabled_by_request",
    records_seen: result2.records?.length || 0,
    records_written: 0
  };
  if (shouldPersist) {
    const fingerprint = await requestFingerprint(sourceKey, body);
    persistence = await persistAdapterResult(env, org.id, result2, {
      operation: result2.operation || mode,
      requestFingerprint: fingerprint,
      force: false,
      entitlement
    });
  }
  return reply(request, env, {
    ok: true,
    service: SERVICE,
    org: { id: org.id, slug: org.slug },
    lane,
    result: responseResult(result2, {
      includeRaw: body.include_raw === true,
      persistence,
      entitlement: {
        origin: entitlement.origin,
        source_class: entitlement.source_class,
        commercial_use: entitlement.commercial_use,
        public_display: entitlement.public_display,
        redistribution: entitlement.redistribution,
        persistence_allowed: entitlement.persistence_allowed,
        attribution_required: entitlement.attribution_required,
        attribution: entitlement.attribution
      }
    })
  }, mode === "ingest" && persistence.persisted ? 201 : 200);
}
__name(fetchAndMaybePersist, "fetchAndMaybePersist");
function queryParams(url) {
  return Object.fromEntries(url.searchParams.entries());
}
__name(queryParams, "queryParams");
async function aisSnapshot(request, env, options, url, restart = false) {
  await protectedContext(request, env, options);
  if (!env.HereTenantAgent) throw new GeoAdapterError("Tenant agent Durable Object binding is unavailable", 503, "durable_object_unavailable");
  const internalUrl = new URL(restart ? "https://internal.mccluster/internal/geo/ais/restart" : "https://internal.mccluster/internal/geo/ais/snapshot");
  if (!restart) {
    const limit = int(url.searchParams.get("limit"), "limit", 1, 5e3, 1e3);
    internalUrl.searchParams.set("limit", String(limit));
    const bbox = url.searchParams.get("bbox");
    if (bbox) {
      const values = String(bbox).split(",").map(Number);
      if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
        throw new GeoAdapterError("bbox must be min_lon,min_lat,max_lon,max_lat", 400, "invalid_parameter");
      }
      finite3(values[0], "min_lon", -180, 180);
      finite3(values[1], "min_lat", -90, 90);
      finite3(values[2], "max_lon", -180, 180);
      finite3(values[3], "max_lat", -90, 90);
      internalUrl.searchParams.set("bbox", values.join(","));
    }
  }
  const id = env.HereTenantAgent.idFromName("geo:ais:mccluster");
  const stub = env.HereTenantAgent.get(id);
  const response = await stub.fetch(new Request(internalUrl, { method: restart ? "POST" : "GET" }));
  if (!response.ok) throw new GeoAdapterError("AIS live cache request failed", 502, "ais_cache_error");
  const data = await response.json();
  return reply(request, env, {
    ok: true,
    service: SERVICE,
    source: "aisstream",
    persistence_policy: "transient",
    attribution: sourceByKey("aisstream")?.attribution || null,
    ...data
  });
}
__name(aisSnapshot, "aisSnapshot");
function viewerConfig(env) {
  const google = Boolean(env.GOOGLE_MAPS_API_KEY);
  const cesium = Boolean(env.CESIUM_ION_TOKEN);
  return {
    keyless: !google && !cesium,
    basemap: {
      // Always available. The console boots on this and only this.
      openstreetmap: {
        url: "https://tile.openstreetmap.org/",
        attribution: "\xA9 OpenStreetMap contributors",
        note: "Subject to the OSM tile usage policy. Move to Mapbox or a self-hosted tile source for heavy use."
      }
    },
    google_photorealistic_3d_tiles: {
      available: google,
      api_key: google ? env.GOOGLE_MAPS_API_KEY : null,
      required_binding: "GOOGLE_MAPS_API_KEY",
      url: "https://tile.googleapis.com/v1/3dtiles/root.json",
      note: "Restrict this key by HTTP referrer. Google map content must not be persisted."
    },
    cesium_ion: {
      available: cesium,
      token: cesium ? env.CESIUM_ION_TOKEN : null,
      required_binding: "CESIUM_ION_TOKEN",
      note: "Use a scoped read-only ion token. World Terrain and ion assets need it; the ellipsoid fallback does not."
    },
    layers: SOURCES.map((source2) => ({
      key: source2.key,
      name: source2.name,
      capabilities: source2.capabilities,
      source_class: source2.sourceClass,
      persistence: source2.persistence,
      transport: source2.transport,
      attribution: source2.attribution,
      credential_required: source2.credentialEnv.length > 0,
      credential_bindings: source2.credentialEnv,
      configured: sourceConfigured(source2, env)
    }))
  };
}
__name(viewerConfig, "viewerConfig");
var geo_default = {
  async fetch(request, env, options = {}) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if ((path === "/v1/geo" || path === "/v1/geo/health") && request.method === "GET") {
        return reply(request, env, {
          ok: true,
          service: SERVICE,
          mode: await schemaReady(env) ? "live" : "adapter-ready",
          adapter_gateway_ready: true,
          edge_access_configured: accessConfigured(env),
          upstream_reference: UPSTREAM,
          upstream_commit: UPSTREAM_COMMIT
        });
      }
      if (path === "/v1/geo/sources" && request.method === "GET") {
        const { org } = await protectedContext(request, env, options);
        const lane = normalizeLane(url.searchParams.get("lane"));
        const rows = await entitlementRows(env, org.id);
        const decorate = entitlementCatalog(rows, lane);
        const catalog = sourceCatalog(env);
        return reply(request, env, {
          ok: true,
          service: SERVICE,
          lane,
          sources: catalog.map((entry) => {
            const source2 = sourceByKey(entry.key);
            const decision = decorate(source2);
            return {
              ...entry,
              entitlement: {
                origin: decision.origin,
                allowed: decision.allowed,
                denied_reason: decision.denied_reason,
                consumable_by: decision.consumable_by,
                commercial_use: decision.commercial_use,
                public_display: decision.public_display,
                redistribution: decision.redistribution,
                persistence_allowed: decision.persistence_allowed,
                expires_at: decision.expires_at
              }
            };
          })
        });
      }
      if (path === "/v1/geo/entitlements" && request.method === "GET") {
        const { org } = await protectedContext(request, env, options);
        const lane = normalizeLane(url.searchParams.get("lane"));
        const rows = await entitlementRows(env, org.id);
        const decorate = entitlementCatalog(rows, lane);
        return reply(request, env, {
          ok: true,
          service: SERVICE,
          org: { id: org.id, slug: org.slug },
          lane,
          lanes: Object.values(LANES),
          entitlements: SOURCES.map(decorate)
        });
      }
      if (path === "/v1/geo/readiness" && request.method === "GET") {
        await protectedContext(request, env, options);
        return reply(request, env, {
          ok: true,
          service: SERVICE,
          database_schema_ready: await schemaReady(env),
          edge_access_configured: accessConfigured(env),
          adapter_capabilities: adapterCapabilities(),
          readiness: readiness(env)
        });
      }
      if (path === "/v1/geo/viewer/config" && request.method === "GET") {
        await protectedContext(request, env, options);
        return reply(request, env, { ok: true, service: SERVICE, config: viewerConfig(env) });
      }
      if (path === "/v1/geo/capabilities" && request.method === "GET") {
        await protectedContext(request, env, options);
        return reply(request, env, {
          ok: true,
          service: SERVICE,
          upstream_reference: UPSTREAM,
          upstream_commit: UPSTREAM_COMMIT,
          adapters: adapterCapabilities(),
          lanes: Object.values(LANES),
          routes: {
            health: "GET /v1/geo/health",
            readiness: "GET /v1/geo/readiness",
            sources: "GET /v1/geo/sources?lane=",
            entitlements: "GET /v1/geo/entitlements?lane=",
            viewer_config: "GET /v1/geo/viewer/config",
            fetch: "POST /v1/geo/fetch/:source",
            ingest: "POST /v1/geo/ingest/:source",
            entities: "GET /v1/geo/entities",
            entity: "GET /v1/geo/entities/:id",
            entity_history: "GET /v1/geo/entities/:id/history",
            nearby: "GET /v1/geo/nearby",
            bbox: "GET /v1/geo/bbox",
            events_nearby: "GET /v1/geo/events/nearby",
            timeline: "GET /v1/geo/timeline",
            projects: "GET /v1/geo/projects",
            layers: "GET /v1/geo/layers",
            ingestion_runs: "GET /v1/geo/ingestion-runs",
            live_ais: "GET /v1/geo/live/ais",
            live_ais_restart: "POST /v1/geo/live/ais/restart"
          }
        });
      }
      const providerMatch = path.match(/^\/v1\/geo\/(fetch|ingest)\/([a-z0-9_-]+)$/i);
      if (providerMatch && request.method === "POST") {
        return await fetchAndMaybePersist(request, env, options, providerMatch[2], providerMatch[1]);
      }
      if (path === "/v1/geo/live/ais" && request.method === "GET") {
        return await aisSnapshot(request, env, options, url, false);
      }
      if (path === "/v1/geo/live/ais/restart" && request.method === "POST") {
        return await aisSnapshot(request, env, options, url, true);
      }
      if (path === "/v1/geo/nearby" && request.method === "GET") {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const params = queryParams(url);
        params.lat = finite3(params.lat, "lat", -90, 90);
        params.lon = finite3(params.lon ?? params.lng, "lon", -180, 180);
        params.radius_m = finite3(params.radius_m, "radius_m", 1, 1e6, 5e3);
        params.limit = int(params.limit, "limit", 1, 1e3, 100);
        const rows = await nearbyEntities(env, org.id, params);
        return reply(request, env, { ok: true, service: SERVICE, entities: rows || [] });
      }
      if (path === "/v1/geo/events/nearby" && request.method === "GET") {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const params = queryParams(url);
        params.lat = finite3(params.lat, "lat", -90, 90);
        params.lon = finite3(params.lon ?? params.lng, "lon", -180, 180);
        params.radius_m = finite3(params.radius_m, "radius_m", 1, 2e6, 25e3);
        params.limit = int(params.limit, "limit", 1, 1e3, 100);
        const rows = await nearbyEvents(env, org.id, params);
        return reply(request, env, { ok: true, service: SERVICE, events: rows || [] });
      }
      if (path === "/v1/geo/timeline" && request.method === "GET") {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const params = queryParams(url);
        params.lat = finite3(params.lat, "lat", -90, 90);
        params.lon = finite3(params.lon ?? params.lng, "lon", -180, 180);
        params.radius_m = finite3(params.radius_m, "radius_m", 1, 2e6, 25e3);
        params.from = isoOrNull(params.from, "from");
        params.to = isoOrNull(params.to, "to");
        params.limit = int(params.limit, "limit", 1, 2e3, 200);
        const rows = await timelineNearby(env, org.id, params);
        return reply(request, env, { ok: true, service: SERVICE, timeline: rows || [] });
      }
      if (path === "/v1/geo/bbox" && request.method === "GET") {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const params = queryParams(url);
        params.min_lat = finite3(params.min_lat, "min_lat", -90, 90);
        params.min_lon = finite3(params.min_lon, "min_lon", -180, 180);
        params.max_lat = finite3(params.max_lat, "max_lat", -90, 90);
        params.max_lon = finite3(params.max_lon, "max_lon", -180, 180);
        if (params.min_lat > params.max_lat || params.min_lon > params.max_lon) {
          throw new GeoAdapterError("bbox minimums must be lower than maximums", 400, "invalid_parameter");
        }
        params.limit = int(params.limit, "limit", 1, 2e3, 500);
        const rows = await entitiesInBbox(env, org.id, params);
        return reply(request, env, { ok: true, service: SERVICE, entities: rows || [] });
      }
      if (path === "/v1/geo/entities" && request.method === "GET") {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const rows = await listEntities(env, org.id, {
          source: url.searchParams.get("source") || null,
          entityType: url.searchParams.get("entity_type") || null,
          limit: int(url.searchParams.get("limit"), "limit", 1, 1e3, 100)
        });
        return reply(request, env, { ok: true, service: SERVICE, entities: rows || [] });
      }
      const historyMatch = path.match(/^\/v1\/geo\/entities\/([0-9a-f-]{36})\/history$/i);
      if (historyMatch && request.method === "GET") {
        if (!UUID_RE.test(historyMatch[1])) throw new GeoAdapterError("Invalid entity id", 400, "invalid_parameter");
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const entity = await getEntity(env, org.id, historyMatch[1]);
        if (!entity) throw new GeoAdapterError("Spatial entity not found", 404, "entity_not_found");
        const limit = int(url.searchParams.get("limit"), "limit", 1, 500, 100);
        const [revisions, observations] = await Promise.all([
          entityRevisions(env, org.id, entity.id, limit),
          entityObservations(env, org.id, entity.id, limit * 2)
        ]);
        return reply(request, env, {
          ok: true,
          service: SERVICE,
          entity,
          revisions: revisions || [],
          observations: observations || []
        });
      }
      const entityMatch = path.match(/^\/v1\/geo\/entities\/([0-9a-f-]{36})$/i);
      if (entityMatch && request.method === "GET") {
        if (!UUID_RE.test(entityMatch[1])) throw new GeoAdapterError("Invalid entity id", 400, "invalid_parameter");
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const entity = await getEntity(env, org.id, entityMatch[1]);
        if (!entity) throw new GeoAdapterError("Spatial entity not found", 404, "entity_not_found");
        return reply(request, env, { ok: true, service: SERVICE, entity });
      }
      if (path === "/v1/geo/projects" && request.method === "GET") {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const rows = await listProjects(env, org.id, int(url.searchParams.get("limit"), "limit", 1, 200, 100));
        return reply(request, env, { ok: true, service: SERVICE, projects: rows || [] });
      }
      if (path === "/v1/geo/layers" && request.method === "GET") {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const rows = await listLayers(env, org.id, int(url.searchParams.get("limit"), "limit", 1, 500, 200));
        return reply(request, env, { ok: true, service: SERVICE, layers: rows || [] });
      }
      if (path === "/v1/geo/ingestion-runs" && request.method === "GET") {
        const { org } = await protectedContext(request, env, options, { requireSchema: true });
        const rows = await listIngestionRuns(env, org.id, {
          source: url.searchParams.get("source") || null,
          limit: int(url.searchParams.get("limit"), "limit", 1, 200, 50)
        });
        return reply(request, env, { ok: true, service: SERVICE, runs: rows || [] });
      }
      return fail(request, env, "Spatial intelligence route not found", 404);
    } catch (error) {
      if (error instanceof AccessError) {
        return fail(request, env, error.message, error.status, { code: error.code });
      }
      const status = Number(error?.status) || 500;
      return fail(
        request,
        env,
        error?.message || "Spatial intelligence request failed",
        status,
        { code: error?.code || "spatial_error", ...error?.detail === void 0 ? {} : { provider_detail: error.detail } }
      );
    }
  }
};

// src/index.js
import GEV_CONSOLE_HTML from "./87d51fd4ccc08cc2c642d71dc352a776fb35b366-console.html";

// src/ai/envelope.js
init_modules_watch_stub();
var PROVIDERS = ["chatgpt", "claude", "grok", "gemini", "copilot", "local", "other"];
var ROLES = ["user", "assistant", "system", "tool", "other"];
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var MAX_MESSAGES = 400;
var MAX_CONTENT = 24e3;
function clean(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}
__name(clean, "clean");
function validateEnvelope(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("envelope required"), { status: 400 });
  }
  const org_id = clean(body.org_id, 36);
  if (!UUID.test(org_id)) throw Object.assign(new Error("org_id required"), { status: 400 });
  const provider = clean(body.provider, 32).toLowerCase();
  if (!PROVIDERS.includes(provider)) {
    throw Object.assign(new Error("provider must be chatgpt, claude, grok, gemini, copilot, local, or other"), { status: 400 });
  }
  const external_conversation_id = clean(body.external_conversation_id, 256);
  if (!external_conversation_id) {
    throw Object.assign(new Error("external_conversation_id required"), { status: 400 });
  }
  const idempotency_key = clean(body.idempotency_key, 256);
  if (!idempotency_key) throw Object.assign(new Error("idempotency_key required"), { status: 400 });
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  if (rawMessages.length > MAX_MESSAGES) {
    throw Object.assign(new Error("too many messages"), { status: 413 });
  }
  const messages = rawMessages.map((item, index) => {
    const row = item && typeof item === "object" ? item : {};
    let role = clean(row.role, 16).toLowerCase();
    if (!ROLES.includes(role)) role = "other";
    return {
      id: clean(row.id, 128) || void 0,
      role,
      model: clean(row.model, 128) || void 0,
      content: clean(row.content, MAX_CONTENT),
      occurred_at: clean(row.occurred_at, 40) || void 0,
      ordinal: Number.isInteger(row.ordinal) ? row.ordinal : index,
      metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {}
    };
  });
  return {
    org_id,
    provider,
    account_label: clean(body.account_label, 64) || "default",
    adapter_version: clean(body.adapter_version, 32) || "1",
    external_conversation_id,
    title: clean(body.title, 240) || void 0,
    source_url: clean(body.source_url, 500) || void 0,
    model_family: clean(body.model_family, 64) || void 0,
    started_at: clean(body.started_at, 40) || void 0,
    last_message_at: clean(body.last_message_at, 40) || void 0,
    metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : {},
    idempotency_key,
    messages
  };
}
__name(validateEnvelope, "validateEnvelope");
var CATALOG = {
  service: "mccluster",
  plane: "control",
  docs: "https://github.com/mcclusterishere/mccluster/blob/main/docs/control-plane/AI-HARNESS.md",
  routes: [
    { path: "/health", method: "GET", auth: "none" },
    { path: "/v1", method: "GET", auth: "none" },
    { path: "/v1/me", method: "GET", auth: "user" },
    { path: "/v1/status", method: "GET", auth: "house-owner" },
    { path: "/v1/apps", method: "GET", auth: "none" },
    { path: "/v1/fees/quote", method: "GET", auth: "none" },
    { path: "/v1/ai/ingest", method: "POST", auth: "house-owner" },
    { path: "/v1/ai/retrieve", method: "POST", auth: "house-owner" },
    { path: "/v1/ai/decisions", method: "POST", auth: "house-owner" },
    { path: "/v1/ai/status", method: "GET", auth: "house-owner" },
    { path: "/v1/media/models", method: "GET", auth: "user" },
    { path: "/v1/media/generate", method: "POST", auth: "user" },
    { path: "/v1/social", method: "GET", auth: "user" },
    { path: "/api/*", method: "*", auth: "whip-identity" }
  ]
};

// src/here-tenant-agent.js
init_modules_watch_stub();
import { DurableObject } from "cloudflare:workers";
var AIS_ENDPOINT = "https://stream.aisstream.io/v0/stream";
var AIS_DEFAULT_BOXES = [[[-90, -180], [90, 180]]];
var AIS_DEFAULT_TYPES = [
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
  "ShipStaticData",
  "StaticDataReport"
];
var AIS_MAX_ROWS = 12e3;
var AIS_STALE_MS = 12e4;
var AIS_ROW_TTL_MS = 36e5;
var AIS_HEARTBEAT_MS = 3e4;
var AIS_BACKOFF_MIN_MS = 15e3;
var AIS_BACKOFF_MAX_MS = 6e5;
var AIS_MAX_PAYLOAD_CHARS = 4e3;
function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}
__name(parseJson, "parseJson");
function parseMessageTypes(value) {
  if (!value) return AIS_DEFAULT_TYPES;
  const parsed = parseJson(value, null);
  if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean).slice(0, 20);
  return String(value).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20);
}
__name(parseMessageTypes, "parseMessageTypes");
function vesselFromMessage(payload) {
  if (!payload || typeof payload !== "object") return null;
  const metadata = payload.MetaData || payload.metaData || {};
  const messageRoot = payload.Message || payload.message || {};
  const messageType = payload.MessageType || payload.messageType || Object.keys(messageRoot)[0] || "unknown";
  const message = messageRoot[messageType] || messageRoot || {};
  const mmsi = Number(metadata.MMSI ?? metadata.mmsi ?? message.UserID ?? message.userId ?? message.MMSI ?? message.mmsi);
  if (!Number.isFinite(mmsi) || mmsi <= 0) return null;
  const latitude = Number(message.Latitude ?? message.latitude ?? metadata.latitude ?? metadata.Latitude);
  const longitude = Number(message.Longitude ?? message.longitude ?? metadata.longitude ?? metadata.Longitude);
  const hasPosition = Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  const shipName = String(metadata.ShipName ?? metadata.shipName ?? message.Name ?? message.name ?? "").trim() || null;
  return {
    mmsi: String(Math.trunc(mmsi)),
    message_type: String(messageType),
    ship_name: shipName,
    latitude: hasPosition ? latitude : null,
    longitude: hasPosition ? longitude : null,
    sog: Number.isFinite(Number(message.Sog ?? message.SOG ?? message.speedOverGround)) ? Number(message.Sog ?? message.SOG ?? message.speedOverGround) : null,
    cog: Number.isFinite(Number(message.Cog ?? message.COG ?? message.courseOverGround)) ? Number(message.Cog ?? message.COG ?? message.courseOverGround) : null,
    heading: Number.isFinite(Number(message.TrueHeading ?? message.trueHeading ?? message.Heading ?? message.heading)) ? Number(message.TrueHeading ?? message.trueHeading ?? message.Heading ?? message.heading) : null,
    nav_status: message.NavigationalStatus ?? message.navigationalStatus ?? null,
    updated_at: (/* @__PURE__ */ new Date()).toISOString(),
    raw: payload
  };
}
__name(vesselFromMessage, "vesselFromMessage");
function boundedPayload(payload) {
  const serialized = JSON.stringify(payload);
  return serialized.length > AIS_MAX_PAYLOAD_CHARS ? JSON.stringify({ truncated: true, message_type: payload?.MessageType || null }) : serialized;
}
__name(boundedPayload, "boundedPayload");
var HereTenantAgent = class extends DurableObject {
  static {
    __name(this, "HereTenantAgent");
  }
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.aisSocket = null;
    this.aisConnecting = null;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS tenant_meta (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS ais_vessels (
        mmsi TEXT PRIMARY KEY,
        ship_name TEXT,
        latitude REAL,
        longitude REAL,
        sog REAL,
        cog REAL,
        heading REAL,
        nav_status TEXT,
        message_type TEXT,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS ais_vessels_updated_idx ON ais_vessels(updated_at DESC)`);
  }
  /*
      Connection state must survive eviction.
  
      A Durable Object holding an OUTBOUND WebSocket cannot hibernate: if the
      object is evicted the socket dies with it, and the in-memory status goes
      with it. Persisting the state here is what lets a woken object tell the
      difference between "never started" and "was streaming a moment ago", and
      lets the backoff survive a crash loop instead of resetting to zero.
    */
  aisState() {
    const rows = this.ctx.storage.sql.exec(`SELECT k, v FROM tenant_meta WHERE k LIKE 'ais_%'`).toArray();
    const state = Object.fromEntries(rows.map((row) => [row.k.slice(4), row.v]));
    return {
      status: state.status || "idle",
      error: state.error || null,
      connected_at: state.connected_at || null,
      last_message_at: state.last_message_at || null,
      failures: Number(state.failures || 0)
    };
  }
  setAisState(patch3) {
    for (const [key, value] of Object.entries(patch3)) {
      if (value === void 0) continue;
      this.ctx.storage.sql.exec(
        `INSERT INTO tenant_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
        `ais_${key}`,
        value === null ? "" : String(value)
      );
    }
  }
  backoffMs(failures) {
    const scaled = AIS_BACKOFF_MIN_MS * Math.pow(2, Math.max(0, failures - 1));
    return Math.min(AIS_BACKOFF_MAX_MS, scaled);
  }
  async armAlarm(delayMs) {
    try {
      const existing = await this.ctx.storage.getAlarm();
      const target = Date.now() + delayMs;
      if (existing && existing <= target) return;
      await this.ctx.storage.setAlarm(target);
    } catch {
    }
  }
  pruneAis() {
    const cutoff = new Date(Date.now() - AIS_ROW_TTL_MS).toISOString();
    this.ctx.storage.sql.exec(`DELETE FROM ais_vessels WHERE updated_at < ?`, cutoff);
    const count = Number(this.ctx.storage.sql.exec(`SELECT count(*) AS n FROM ais_vessels`).toArray()[0]?.n || 0);
    if (count > AIS_MAX_ROWS) {
      this.ctx.storage.sql.exec(
        `DELETE FROM ais_vessels WHERE mmsi IN (SELECT mmsi FROM ais_vessels ORDER BY updated_at ASC LIMIT ?)`,
        count - AIS_MAX_ROWS
      );
    }
  }
  recordVessel(vessel) {
    const previous = this.ctx.storage.sql.exec(
      `SELECT ship_name, latitude, longitude, sog, cog, heading, nav_status FROM ais_vessels WHERE mmsi = ? LIMIT 1`,
      vessel.mmsi
    ).toArray()[0] || {};
    this.ctx.storage.sql.exec(
      `INSERT INTO ais_vessels (mmsi, ship_name, latitude, longitude, sog, cog, heading, nav_status, message_type, payload, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mmsi) DO UPDATE SET
         ship_name = COALESCE(excluded.ship_name, ais_vessels.ship_name),
         latitude = COALESCE(excluded.latitude, ais_vessels.latitude),
         longitude = COALESCE(excluded.longitude, ais_vessels.longitude),
         sog = COALESCE(excluded.sog, ais_vessels.sog),
         cog = COALESCE(excluded.cog, ais_vessels.cog),
         heading = COALESCE(excluded.heading, ais_vessels.heading),
         nav_status = COALESCE(excluded.nav_status, ais_vessels.nav_status),
         message_type = excluded.message_type,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
      vessel.mmsi,
      vessel.ship_name || previous.ship_name || null,
      vessel.latitude ?? previous.latitude ?? null,
      vessel.longitude ?? previous.longitude ?? null,
      vessel.sog ?? previous.sog ?? null,
      vessel.cog ?? previous.cog ?? null,
      vessel.heading ?? previous.heading ?? null,
      vessel.nav_status === null || vessel.nav_status === void 0 ? previous.nav_status ?? null : String(vessel.nav_status),
      vessel.message_type,
      boundedPayload(vessel.raw),
      vessel.updated_at
    );
  }
  async ensureAis() {
    if (!this.env.AISSTREAM_API_KEY) {
      this.setAisState({ status: "unconfigured", error: null });
      return false;
    }
    if (this.aisSocket) return true;
    if (this.aisConnecting) return this.aisConnecting;
    this.aisConnecting = (async () => {
      this.setAisState({ status: "connecting", error: null });
      try {
        const response = await fetch(AIS_ENDPOINT, { headers: { Upgrade: "websocket" } });
        const socket = response.webSocket;
        if (!socket) throw new Error(`AISStream rejected websocket upgrade (${response.status})`);
        socket.accept();
        this.aisSocket = socket;
        this.setAisState({
          status: "open",
          error: null,
          connected_at: (/* @__PURE__ */ new Date()).toISOString(),
          failures: 0
        });
        const boundingBoxes = parseJson(this.env.AISSTREAM_BOUNDING_BOXES, AIS_DEFAULT_BOXES);
        const messageTypes = parseMessageTypes(this.env.AISSTREAM_MESSAGE_TYPES);
        socket.send(JSON.stringify({
          APIKey: this.env.AISSTREAM_API_KEY,
          BoundingBoxes: boundingBoxes,
          FilterMessageTypes: messageTypes
        }));
        let sinceLastPrune = 0;
        socket.addEventListener("message", (event) => {
          try {
            const payload = JSON.parse(String(event.data || "{}"));
            if (payload?.error || payload?.Error) {
              const message = String(payload.error || payload.Error).slice(0, 300);
              this.setAisState({ status: /api key|auth|invalid/i.test(message) ? "auth-failed" : "error", error: message });
              try {
                socket.close(1011, "aisstream error frame");
              } catch {
              }
              return;
            }
            const vessel = vesselFromMessage(payload);
            if (!vessel) return;
            this.recordVessel(vessel);
            this.setAisState({ last_message_at: vessel.updated_at, status: "open" });
            sinceLastPrune += 1;
            if (sinceLastPrune >= 500) {
              sinceLastPrune = 0;
              this.pruneAis();
            }
          } catch {
          }
        });
        const recycle = /* @__PURE__ */ __name((status, error = null) => {
          if (this.aisSocket !== socket) return;
          this.aisSocket = null;
          const failures = this.aisState().failures + 1;
          const current = this.aisState().status;
          this.setAisState({
            status: current === "auth-failed" ? "auth-failed" : status,
            error: error ? String(error).slice(0, 300) : this.aisState().error,
            failures
          });
          void this.armAlarm(this.backoffMs(failures));
        }, "recycle");
        socket.addEventListener("close", () => {
          recycle("closed");
        });
        socket.addEventListener("error", () => {
          recycle("error", "AISStream websocket error");
        });
        await this.armAlarm(AIS_HEARTBEAT_MS);
        return true;
      } catch (error) {
        this.aisSocket = null;
        const message = String(error?.message || error);
        const failures = this.aisState().failures + 1;
        this.setAisState({
          status: /401|403|auth/i.test(message) ? "auth-failed" : "error",
          error: message.slice(0, 300),
          failures
        });
        await this.armAlarm(this.backoffMs(failures));
        return false;
      } finally {
        this.aisConnecting = null;
      }
    })();
    return this.aisConnecting;
  }
  /*
    The heartbeat. Because the socket cannot outlive an eviction, the alarm is
    what makes the stream persistent rather than merely long-lived: it wakes the
    object, reconnects if the socket is gone, prunes, and re-arms itself.
  */
  async alarm() {
    if (!this.env.AISSTREAM_API_KEY) {
      this.setAisState({ status: "unconfigured" });
      return;
    }
    this.pruneAis();
    if (!this.aisSocket) await this.ensureAis();
    const { status, failures } = this.aisState();
    await this.armAlarm(status === "auth-failed" ? AIS_BACKOFF_MAX_MS : Math.max(AIS_HEARTBEAT_MS, this.backoffMs(failures)));
  }
  aisSnapshot({ limit = 1e3, bbox = null } = {}) {
    const clauses = ["latitude IS NOT NULL", "longitude IS NOT NULL"];
    const args = [];
    if (bbox) {
      clauses.push("longitude >= ?", "latitude >= ?", "longitude <= ?", "latitude <= ?");
      args.push(bbox[0], bbox[1], bbox[2], bbox[3]);
    }
    const capped = Math.max(1, Math.min(Number(limit) || 1e3, AIS_MAX_ROWS));
    const rows = this.ctx.storage.sql.exec(
      `SELECT mmsi, ship_name, latitude, longitude, sog, cog, heading, nav_status, message_type, updated_at
         FROM ais_vessels
        WHERE ${clauses.join(" AND ")}
        ORDER BY updated_at DESC
        LIMIT ?`,
      ...args,
      capped
    ).toArray();
    const state = this.aisState();
    const total = Number(this.ctx.storage.sql.exec(`SELECT count(*) AS n FROM ais_vessels`).toArray()[0]?.n || 0);
    const lastMs = state.last_message_at ? Date.parse(state.last_message_at) : 0;
    const stale = Boolean(lastMs && Date.now() - lastMs > AIS_STALE_MS);
    return {
      configured: Boolean(this.env.AISSTREAM_API_KEY),
      status: stale && state.status === "open" ? "stale" : state.status,
      stale,
      error: state.error || null,
      failures: state.failures,
      connected_at: state.connected_at || null,
      last_message_at: state.last_message_at || null,
      cached_vessels: total,
      returned: rows.length,
      row_ttl_seconds: AIS_ROW_TTL_MS / 1e3,
      rows
    };
  }
  async fetch(request) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const url = new URL(request.url);
    if (url.pathname === "/internal/geo/ais/snapshot" && request.method === "GET") {
      if (this.env.AISSTREAM_API_KEY && !this.aisSocket) {
        this.ctx.waitUntil(this.ensureAis());
      }
      const bboxParam = url.searchParams.get("bbox");
      const bbox = bboxParam ? bboxParam.split(",").map(Number) : null;
      return Response.json(this.aisSnapshot({
        limit: url.searchParams.get("limit"),
        bbox: bbox && bbox.length === 4 && bbox.every(Number.isFinite) ? bbox : null
      }));
    }
    if (url.pathname === "/internal/geo/ais/restart" && request.method === "POST") {
      try {
        this.aisSocket?.close(1e3, "operator restart");
      } catch {
      }
      this.aisSocket = null;
      this.setAisState({ status: "idle", error: null, failures: 0 });
      await this.ensureAis();
      return Response.json(this.aisSnapshot({ limit: 1 }));
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO tenant_meta (k, v) VALUES ('last_seen', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      now
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO tenant_meta (k, v) VALUES ('last_path', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      url.pathname
    );
    const existing = this.ctx.storage.sql.exec(`SELECT v FROM tenant_meta WHERE k = 'hits'`).toArray();
    const hits = Number(existing[0]?.v || 0) + 1;
    this.ctx.storage.sql.exec(
      `INSERT INTO tenant_meta (k, v) VALUES ('hits', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      String(hits)
    );
    return Response.json({
      ok: true,
      service: "here-tenant-agent",
      worker: "mccluster",
      stub: false,
      last_seen: now,
      hits
    });
  }
};

// src/index.js
function configured2(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}
__name(configured2, "configured");
function sbHeaders6(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json"
  };
}
__name(sbHeaders6, "sbHeaders");
async function sb6(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders6(env) });
  const text2 = await res.text();
  let data = null;
  try {
    data = text2 ? JSON.parse(text2) : null;
  } catch {
    data = text2;
  }
  if (!res.ok) throw Object.assign(new Error("McCluster database request failed"), { status: res.status, detail: data });
  return data;
}
__name(sb6, "sb");
async function sbCount(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: { ...sbHeaders6(env), prefer: "count=exact", range: "0-0" }
  });
  if (!res.ok) return null;
  const range = res.headers.get("content-range") || "";
  const total = range.split("/")[1];
  return total && total !== "*" ? Number(total) : null;
}
__name(sbCount, "sbCount");
async function authUser2(req, env) {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization }
  });
  if (!res.ok) return null;
  return res.json();
}
__name(authUser2, "authUser");
async function requireHouseOwner(req, env) {
  const user4 = await authUser2(req, env);
  if (!user4) throw Object.assign(new Error("Authentication required"), { status: 401 });
  const orgs = await sb6(env, "orgs?slug=eq.mccluster&select=id&limit=1");
  const houseId = orgs?.[0]?.id;
  if (!houseId) throw Object.assign(new Error("McCluster house organization is not configured"), { status: 503 });
  const memberships = await sb6(env, `org_members?org_id=eq.${encodeURIComponent(houseId)}&profile_id=eq.${encodeURIComponent(user4.id)}&role=eq.owner&select=org_id,role&limit=1`);
  if (!memberships?.length) throw Object.assign(new Error("McCluster house owner access required"), { status: 403 });
  return user4;
}
__name(requireHouseOwner, "requireHouseOwner");
async function appByKey(env, key) {
  const rows = await sb6(env, `platform_apps?app_key=eq.${encodeURIComponent(key)}&enabled=eq.true&select=*`);
  return rows?.[0] || null;
}
__name(appByKey, "appByKey");
async function feePolicy(env, appId, orgId) {
  const orgFilter = orgId ? `&org_id=eq.${encodeURIComponent(orgId)}` : "&org_id=is.null";
  let rows = await sb6(env, `platform_fee_policies?app_id=eq.${encodeURIComponent(appId)}${orgFilter}&enabled=eq.true&order=effective_at.desc&limit=1&select=*`);
  if (!rows?.length && orgId) {
    rows = await sb6(env, `platform_fee_policies?app_id=eq.${encodeURIComponent(appId)}&org_id=is.null&enabled=eq.true&order=effective_at.desc&limit=1&select=*`);
  }
  return rows?.[0] || null;
}
__name(feePolicy, "feePolicy");
function pct(cents, bps) {
  return Math.round(Number(cents || 0) * Number(bps || 0) / 1e4);
}
__name(pct, "pct");
var src_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (path === "/health" && request.method === "GET") {
        return reply(request, env, {
          ok: true,
          service: "mccluster"
        });
      }
      if (path === "/v1" && request.method === "GET") {
        return reply(request, env, CATALOG);
      }
      if (path === "/v1/geo" || path.startsWith("/v1/geo/")) {
        return geo_default.fetch(request, env, { requireHouseOwner });
      }
      if (path === "/internal/gev" && request.method === "GET") {
        try {
          await verifyAccess(request, env);
        } catch (error) {
          if (error instanceof AccessError) return fail(request, env, error.message, error.status, { code: error.code });
          throw error;
        }
        return new Response(GEV_CONSOLE_HTML, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "private, no-store",
            "x-robots-tag": "noindex, nofollow, noarchive, noimageindex",
            "x-frame-options": "DENY",
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
            "permissions-policy": "geolocation=(), microphone=(), camera=()",
            "content-security-policy": [
              "default-src 'none'",
              "base-uri 'none'",
              "form-action 'none'",
              "frame-ancestors 'none'",
              // CesiumJS compiles WebAssembly (Draco, Basis) and evaluates
              // generated shader/glTF code at runtime. Verified in a cold
              // browser: without these the globe never constructs at all.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net blob:",
              "worker-src blob: https://cdn.jsdelivr.net",
              "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
              "font-src https://cdn.jsdelivr.net data:",
              "img-src 'self' data: blob: https://tile.openstreetmap.org https://cdn.jsdelivr.net https://tile.googleapis.com https://*.googleapis.com https://*.gstatic.com https://*.cesium.com",
              // Cesium requests imagery and terrain tiles with XHR, not <img>,
              // so every tile host must appear here as well as in img-src.
              // Verified in a cold browser: omitting tile.openstreetmap.org
              // renders a blank globe with no error the user can see.
              "connect-src 'self' https://zmnhbrjyhxzhkxmhkexs.supabase.co https://cdn.jsdelivr.net https://tile.openstreetmap.org https://tile.googleapis.com https://*.googleapis.com https://*.gstatic.com https://api.cesium.com https://assets.ion.cesium.com https://*.cesium.com"
            ].join("; ")
          }
        });
      }
      if (!configured2(env)) return fail(request, env, "McCluster is not configured", 503);
      if (path === "/internal/here-tenant-agent" && request.method === "GET") {
        await requireHouseOwner(request, env);
        const id = env.HereTenantAgent.idFromName("health");
        const stub = env.HereTenantAgent.get(id);
        return stub.fetch(request);
      }
      if (path === "/v1/me" && request.method === "GET") {
        const user4 = await authUser2(request, env);
        if (!user4) return fail(request, env, "Authentication required", 401);
        return reply(request, env, {
          user: { id: user4.id, email: user4.email, phone: user4.phone, user_metadata: user4.user_metadata || {} }
        });
      }
      if (path === "/v1/status" && request.method === "GET") {
        const user4 = await requireHouseOwner(request, env);
        const [apps, requests, inboxIn, convos, channels] = await Promise.all([
          sbCount(env, "platform_apps?enabled=eq.true&select=id"),
          sbCount(env, "site_requests?select=id"),
          sbCount(env, "inbox_messages?direction=eq.in&select=id"),
          sbCount(env, "inbox_conversations?select=id"),
          sb6(env, "inbox_channels?select=key,enabled").catch(() => null)
        ]);
        const harness = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/ai_harness_status`, {
          method: "POST",
          headers: sbHeaders6(env),
          body: JSON.stringify({ p_org: (await sb6(env, "orgs?slug=eq.mccluster&select=id&limit=1"))?.[0]?.id })
        }).then(async (res) => res.ok ? res.json() : null).catch(() => null);
        return reply(request, env, {
          ok: true,
          checked_at: (/* @__PURE__ */ new Date()).toISOString(),
          operator: { id: user4.id, email: user4.email },
          database: {
            reachable: apps !== null
          },
          worker: {
            service: "mccluster",
            durable_object_bound: Boolean(env.HereTenantAgent),
            allowed_origins: allowedOrigins(env).length
          },
          counts: {
            apps_enabled: apps,
            site_requests: requests,
            inbox_messages_in: inboxIn,
            conversations: convos
          },
          channels: Array.isArray(channels) ? channels : [],
          harness: harness || { ok: false, schema: "ai_context" }
        });
      }
      if (path === "/v1/apps" && request.method === "GET") {
        const rows = await sb6(env, "platform_apps?enabled=eq.true&order=product_family.asc,name.asc&select=app_key,name,product_family,kind,bundle_id,public_url");
        return reply(request, env, { apps: rows || [] });
      }
      if (path === "/v1/fees/quote" && request.method === "GET") {
        const appKey = url.searchParams.get("app_key");
        const baseCents = Math.max(0, Math.round(Number(url.searchParams.get("base_cents") || 0)));
        const whiteLabel = ["1", "true", "yes"].includes(String(url.searchParams.get("white_label") || "").toLowerCase());
        const orgId = url.searchParams.get("org_id") || null;
        if (!appKey || !baseCents) return fail(request, env, "app_key and positive base_cents are required");
        const app = await appByKey(env, appKey);
        if (!app) return fail(request, env, "Unknown McCluster application", 404);
        const policy = await feePolicy(env, app.id, orgId);
        if (!policy) return fail(request, env, "No fee policy configured for this application", 404);
        const payerFee = pct(baseCents, policy.payer_fee_bps);
        const receiverBps = whiteLabel ? policy.white_label_payee_fee_bps : policy.payee_fee_bps;
        const receiverFee = pct(baseCents, receiverBps);
        return reply(request, env, {
          app: { key: app.app_key, name: app.name },
          policy: {
            key: policy.policy_key,
            currency: policy.currency,
            payer_fee_bps: policy.payer_fee_bps,
            payee_fee_bps: receiverBps,
            white_label: whiteLabel,
            white_label_subscription_cents: policy.white_label_subscription_cents
          },
          quote: {
            base_amount_cents: baseCents,
            payer_fee_cents: payerFee,
            payer_total_cents: baseCents + payerFee,
            payee_fee_cents: receiverFee,
            platform_revenue_before_processing_cents: payerFee + receiverFee,
            payee_economic_amount_cents: Math.max(0, baseCents - receiverFee)
          }
        });
      }
      if (path === "/api" || path.startsWith("/api/")) {
        const response = await identity_gateway_default.fetch(request, env);
        return applyCors(request, env, response);
      }
      return fail(request, env, "Not found", 404);
    } catch (error) {
      logEvent("error", {
        path,
        method: request.method,
        message: error instanceof Error ? error.message : String(error),
        status: error.status || 500
      });
      return fail(request, env, error.message || "McCluster request failed", error.status || 500, error.detail);
    }
  }
};

// src/client.js
init_modules_watch_stub();
var MAX_BODY_BYTES = 16 * 1024;
var BOOKING_STATES = /* @__PURE__ */ new Set([
  "new",
  "needs-reply",
  "qualified",
  "date-proposed",
  "confirmed",
  "completed",
  "archived",
  "declined"
]);
function configured3(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}
__name(configured3, "configured");
function sbHeaders7(env, prefer) {
  const headers7 = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json"
  };
  if (prefer) headers7.prefer = prefer;
  return headers7;
}
__name(sbHeaders7, "sbHeaders");
async function sbRequest(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method || "GET",
    headers: sbHeaders7(env, init.prefer),
    body: init.body === void 0 ? void 0 : JSON.stringify(init.body)
  });
  const text2 = await res.text();
  let data = null;
  try {
    data = text2 ? JSON.parse(text2) : null;
  } catch {
    data = text2;
  }
  if (!res.ok) {
    throw Object.assign(new Error("McCluster database request failed"), {
      status: res.status,
      detail: data
    });
  }
  return data;
}
__name(sbRequest, "sbRequest");
async function authUser3(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization
    }
  });
  if (!res.ok) return null;
  return res.json();
}
__name(authUser3, "authUser");
function safeSlug2(value) {
  const slug = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug) ? slug : null;
}
__name(safeSlug2, "safeSlug");
function clean2(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}
__name(clean2, "clean");
function validEmail(value) {
  const email = clean2(value, 320).toLowerCase();
  return email && email.includes("@") && !/\s/.test(email) ? email : null;
}
__name(validEmail, "validEmail");
async function jsonBody2(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request body is too large"), { status: 413 });
  }
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error("Valid JSON is required"), { status: 400 });
  }
}
__name(jsonBody2, "jsonBody");
async function orgBySlug(env, rawSlug) {
  const slug = safeSlug2(rawSlug);
  if (!slug) return null;
  const rows = await sbRequest(
    env,
    `orgs?slug=eq.${encodeURIComponent(slug)}&enabled=eq.true&select=id,slug,name,kind,settings&limit=1`
  );
  return rows?.[0] || null;
}
__name(orgBySlug, "orgBySlug");
async function requireClientMember(request, env, rawSlug) {
  const user4 = await authUser3(request, env);
  if (!user4) throw Object.assign(new Error("Authentication required"), { status: 401 });
  const org = await orgBySlug(env, rawSlug);
  if (!org || org.kind !== "client") {
    throw Object.assign(new Error("Client tenant not found"), { status: 404 });
  }
  const memberships = await sbRequest(
    env,
    `org_members?org_id=eq.${encodeURIComponent(org.id)}&profile_id=eq.${encodeURIComponent(user4.id)}&select=role&limit=1`
  );
  const membership = memberships?.[0];
  if (!membership) throw Object.assign(new Error("Client tenant access required"), { status: 403 });
  return { user: user4, org, role: membership.role };
}
__name(requireClientMember, "requireClientMember");
function settingsObject(org) {
  return org?.settings && typeof org.settings === "object" && !Array.isArray(org.settings) ? { ...org.settings } : {};
}
__name(settingsObject, "settingsObject");
function contentObject(org) {
  const settings = settingsObject(org);
  return settings.site_content && typeof settings.site_content === "object" && !Array.isArray(settings.site_content) ? { ...settings.site_content } : {};
}
__name(contentObject, "contentObject");
async function writeOrgSettings(env, orgId, settings) {
  const rows = await sbRequest(
    env,
    `orgs?id=eq.${encodeURIComponent(orgId)}&select=id,slug,name,kind,settings`,
    { method: "PATCH", body: { settings }, prefer: "return=representation" }
  );
  return rows?.[0] || null;
}
__name(writeOrgSettings, "writeOrgSettings");
function publishedContent(org) {
  const content = contentObject(org);
  const out = {};
  for (const [key, value] of Object.entries(content)) {
    if (!value || typeof value !== "object" || value.published == null) continue;
    out[key] = value.published;
  }
  return out;
}
__name(publishedContent, "publishedContent");
async function publicInquiry(request, env) {
  const body = await jsonBody2(request);
  const org = await orgBySlug(env, body.org);
  if (!org || org.kind !== "client") return fail(request, env, "Unknown client", 404);
  const name = clean2(body.name, 160);
  const email = validEmail(body.email);
  if (!name || !email) return fail(request, env, "A valid name and email are required", 400);
  const row = {
    org_id: org.id,
    name,
    email,
    want: clean2(body.want, 200),
    note: clean2(body.note, 4e3),
    page: clean2(body.page, 500),
    source: clean2(body.source || "direct", 100) || "direct",
    medium: body.medium ? clean2(body.medium, 100) : null,
    campaign: body.campaign ? clean2(body.campaign, 160) : null,
    gclid: body.gclid ? clean2(body.gclid, 300) : null,
    status: "new"
  };
  const rows = await sbRequest(env, "leads?select=id,at,status", {
    method: "POST",
    body: row,
    prefer: "return=representation"
  });
  return reply(request, env, { ok: true, inquiry: rows?.[0] || null }, 201);
}
__name(publicInquiry, "publicInquiry");
function authRedirectFor(request) {
  const origin = request.headers.get("origin") || "";
  if (origin === "https://mcclusterishere.github.io") {
    return "https://mcclusterishere.github.io/esmer/auth/?next=/esmer/book/";
  }
  if (origin === "https://esmer.mccluster.org") {
    return "https://esmer.mccluster.org/auth/?next=/book/";
  }
  return null;
}
__name(authRedirectFor, "authRedirectFor");
async function accountStart(request, env) {
  const body = await jsonBody2(request);
  const org = await orgBySlug(env, body.org);
  if (!org || org.kind !== "client") return fail(request, env, "Unknown client", 404);
  const email = validEmail(body.email);
  if (!email) return fail(request, env, "A valid email is required", 400);
  const redirect = authRedirectFor(request);
  const payload = { email, create_user: true };
  if (redirect) payload.options = { email_redirect_to: redirect };
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/otp`, {
    method: "POST",
    headers: sbHeaders7(env),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const detail = await res.text();
    throw Object.assign(new Error("Could not send sign-in link"), { status: res.status, detail });
  }
  return reply(request, env, { ok: true }, 202);
}
__name(accountStart, "accountStart");
async function publicEvent(request, env) {
  const body = await jsonBody2(request);
  const org = await orgBySlug(env, body.org);
  if (!org || org.kind !== "client") return fail(request, env, "Unknown client", 404);
  const allowed = /* @__PURE__ */ new Set(["page_view", "music_click", "book_view", "inquiry_submit"]);
  const name = clean2(body.name, 80);
  if (!allowed.has(name)) return fail(request, env, "Unknown event", 400);
  const props = {
    org: org.slug,
    source: clean2(body.source || "site", 80),
    href: body.href ? clean2(body.href, 500) : void 0
  };
  await sbRequest(env, "events", {
    method: "POST",
    body: {
      name,
      path: clean2(body.path, 500),
      props
    },
    prefer: "return=minimal"
  });
  return reply(request, env, { ok: true }, 202);
}
__name(publicEvent, "publicEvent");
async function listInquiries(request, env, org) {
  const rows = await sbRequest(
    env,
    `leads?org_id=eq.${encodeURIComponent(org.id)}&order=at.desc&limit=100&select=id,at,name,email,want,note,page,source,status`
  );
  return reply(request, env, { items: rows || [] });
}
__name(listInquiries, "listInquiries");
async function inquiryDetail(request, env, org, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(request, env, "Invalid inquiry id", 400);
  if (request.method === "GET") {
    const rows = await sbRequest(
      env,
      `leads?id=eq.${encodeURIComponent(id)}&org_id=eq.${encodeURIComponent(org.id)}&select=id,at,name,email,want,note,page,source,status&limit=1`
    );
    if (!rows?.length) return fail(request, env, "Inquiry not found", 404);
    return reply(request, env, rows[0]);
  }
  if (request.method === "PATCH") {
    const body = await jsonBody2(request);
    const status = clean2(body.status, 40);
    if (!BOOKING_STATES.has(status)) return fail(request, env, "Invalid inquiry status", 400);
    const rows = await sbRequest(
      env,
      `leads?id=eq.${encodeURIComponent(id)}&org_id=eq.${encodeURIComponent(org.id)}&select=id,at,name,email,want,note,page,source,status`,
      { method: "PATCH", body: { status }, prefer: "return=representation" }
    );
    if (!rows?.length) return fail(request, env, "Inquiry not found", 404);
    return reply(request, env, rows[0]);
  }
  return null;
}
__name(inquiryDetail, "inquiryDetail");
async function listContacts(request, env, org) {
  const leads = await sbRequest(
    env,
    `leads?org_id=eq.${encodeURIComponent(org.id)}&order=at.desc&limit=500&select=name,email,at,status,want`
  );
  const seen = /* @__PURE__ */ new Map();
  for (const lead of leads || []) {
    const key = String(lead.email || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.set(key, {
      name: lead.name,
      email: lead.email,
      last_interaction: lead.at,
      status: lead.status,
      last_interest: lead.want
    });
  }
  return reply(request, env, { items: [...seen.values()] });
}
__name(listContacts, "listContacts");
async function analytics(request, env, org) {
  const leads = await sbRequest(
    env,
    `leads?org_id=eq.${encodeURIComponent(org.id)}&order=at.desc&limit=1000&select=id,at,status`
  );
  const now = Date.now();
  const thirtyDays = now - 30 * 24 * 60 * 60 * 1e3;
  const inquiries30d = (leads || []).filter((row) => Date.parse(row.at) >= thirtyDays).length;
  const newInquiries = (leads || []).filter((row) => row.status === "new" || row.status === "needs-reply").length;
  let events = [];
  try {
    const since = new Date(thirtyDays).toISOString();
    events = await sbRequest(
      env,
      `events?at=gte.${encodeURIComponent(since)}&props->>org=eq.${encodeURIComponent(org.slug)}&limit=5000&select=name,uid,path,props,at`
    );
  } catch {
    events = [];
  }
  const visitorIds = /* @__PURE__ */ new Set();
  let pageViews = 0;
  let musicClicks = 0;
  let bookViews = 0;
  for (const event of events || []) {
    if (event.uid) visitorIds.add(event.uid);
    if (event.name === "page_view") pageViews += 1;
    if (event.name === "music_click") musicClicks += 1;
    if (event.name === "book_view") bookViews += 1;
  }
  return reply(request, env, {
    visitors30d: visitorIds.size || null,
    pageViews30d: pageViews,
    musicClicks,
    bookViews,
    inquiries30d,
    newInquiries
  });
}
__name(analytics, "analytics");
async function getContent(request, env, org) {
  return reply(request, env, { content: contentObject(org) });
}
__name(getContent, "getContent");
async function saveContent(request, env, member, key) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) return fail(request, env, "Invalid content key", 400);
  const body = await jsonBody2(request);
  const draft = body.draft;
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return fail(request, env, "draft must be an object", 400);
  }
  const serialized = JSON.stringify(draft);
  if (serialized.length > 12e3) return fail(request, env, "Draft is too large", 413);
  const settings = settingsObject(member.org);
  const content = contentObject(member.org);
  const previous = content[key] && typeof content[key] === "object" ? content[key] : {};
  content[key] = {
    ...previous,
    draft,
    updated_at: (/* @__PURE__ */ new Date()).toISOString(),
    updated_by: member.user.id
  };
  settings.site_content = content;
  const updated = await writeOrgSettings(env, member.org.id, settings);
  member.org = updated || member.org;
  return reply(request, env, { key, record: content[key] });
}
__name(saveContent, "saveContent");
async function publishContent(request, env, member) {
  const body = await jsonBody2(request);
  const key = clean2(body.key, 64);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) return fail(request, env, "Invalid content key", 400);
  const settings = settingsObject(member.org);
  const content = contentObject(member.org);
  const record2 = content[key];
  if (!record2 || !record2.draft || typeof record2.draft !== "object") {
    return fail(request, env, "No draft exists for this content", 409);
  }
  content[key] = {
    ...record2,
    published: record2.draft,
    published_at: (/* @__PURE__ */ new Date()).toISOString(),
    published_by: member.user.id
  };
  settings.site_content = content;
  const updated = await writeOrgSettings(env, member.org.id, settings);
  member.org = updated || member.org;
  return reply(request, env, { key, record: content[key] });
}
__name(publishContent, "publishContent");
async function listMedia(request, env, org) {
  const rows = await sbRequest(
    env,
    `media_assets?org_id=eq.${encodeURIComponent(org.id)}&order=created_at.desc&limit=200&select=id,asset_type,role,url,storage_path,mime_type,width,height,duration_seconds,metadata,created_at`
  );
  return reply(request, env, { items: rows || [] });
}
__name(listMedia, "listMedia");
async function handleClientRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const isClientSurface = path === "/v1/inquiries" || path === "/v1/account/start" || path === "/v1/events" || path.startsWith("/v1/public/") || path.startsWith("/v1/clients/");
  if (!isClientSurface) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }
  if (!configured3(env)) return fail(request, env, "McCluster is not configured", 503);
  if (path === "/v1/inquiries" && request.method === "POST") return publicInquiry(request, env);
  if (path === "/v1/account/start" && request.method === "POST") return accountStart(request, env);
  if (path === "/v1/events" && request.method === "POST") return publicEvent(request, env);
  const publicMatch = path.match(/^\/v1\/public\/([a-z0-9-]+)\/content$/);
  if (publicMatch && request.method === "GET") {
    const org = await orgBySlug(env, publicMatch[1]);
    if (!org || org.kind !== "client") return fail(request, env, "Client tenant not found", 404);
    return reply(request, env, { content: publishedContent(org) });
  }
  const match = path.match(/^\/v1\/clients\/([a-z0-9-]+)(?:\/(.*))?$/);
  if (!match) return fail(request, env, "Not found", 404);
  const slug = match[1];
  const tail = match[2] || "me";
  const member = await requireClientMember(request, env, slug);
  if (tail === "me" && request.method === "GET") {
    return reply(request, env, {
      tenant: {
        id: member.org.id,
        slug: member.org.slug,
        name: member.org.name,
        role: member.role
      },
      user: {
        id: member.user.id,
        email: member.user.email
      }
    });
  }
  if (tail === "inquiries" && request.method === "GET") return listInquiries(request, env, member.org);
  const inquiryMatch = tail.match(/^inquiries\/([0-9a-f-]{36})$/i);
  if (inquiryMatch) {
    const response = await inquiryDetail(request, env, member.org, inquiryMatch[1]);
    if (response) return response;
  }
  if (tail === "contacts" && request.method === "GET") return listContacts(request, env, member.org);
  if (tail === "analytics" && request.method === "GET") return analytics(request, env, member.org);
  if (tail === "content" && request.method === "GET") return getContent(request, env, member.org);
  const contentMatch = tail.match(/^content\/([a-z0-9-]+)$/);
  if (contentMatch && request.method === "PATCH") return saveContent(request, env, member, contentMatch[1]);
  if (tail === "publish" && request.method === "POST") return publishContent(request, env, member);
  if (tail === "media" && request.method === "GET") return listMedia(request, env, member.org);
  if (tail === "press" && request.method === "GET") return reply(request, env, { items: [] });
  if (tail === "network" && request.method === "GET") return reply(request, env, { items: [] });
  return fail(request, env, "Not found", 404);
}
__name(handleClientRequest, "handleClientRequest");

// src/connect.js
init_modules_watch_stub();

// src/inquiries.js
init_modules_watch_stub();
var RESEND_API = "https://api.resend.com/emails";
function sbHeaders8(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
    ...extra
  };
}
__name(sbHeaders8, "sbHeaders");
async function sb7(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: sbHeaders8(env, init.headers || {})
  });
  const text2 = await res.text();
  let data = null;
  try {
    data = text2 ? JSON.parse(text2) : null;
  } catch {
    data = text2;
  }
  if (!res.ok) {
    throw Object.assign(new Error(typeof data === "string" ? data : data?.message || "Database request failed"), {
      status: res.status
    });
  }
  return data;
}
__name(sb7, "sb");
async function upsertConversation(env, org, { name, email, want, note, page }) {
  const found = await sb7(
    env,
    `inbox_contacts?org_id=eq.${encodeURIComponent(org.id)}&channel=eq.site&email=eq.${encodeURIComponent(email)}&select=id&limit=1`
  );
  let contactId = found?.[0]?.id;
  if (!contactId) {
    const made = await sb7(env, "inbox_contacts", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        org_id: org.id,
        channel: "site",
        /* external_id is the channel's own id for a person. On the site
           channel that is the address they wrote in with. */
        external_id: email,
        email,
        display_name: name
      })
    });
    contactId = made?.[0]?.id;
  }
  if (!contactId) return null;
  const open = await sb7(
    env,
    `inbox_conversations?org_id=eq.${encodeURIComponent(org.id)}&contact_id=eq.${encodeURIComponent(contactId)}&status=eq.open&select=id&limit=1`
  );
  let convId = open?.[0]?.id;
  if (!convId) {
    const made = await sb7(env, "inbox_conversations", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        org_id: org.id,
        contact_id: contactId,
        channel: "site",
        kind: "dm",
        subject_ref: page || "/book",
        status: "open",
        last_at: (/* @__PURE__ */ new Date()).toISOString()
      })
    });
    convId = made?.[0]?.id;
  }
  if (!convId) return null;
  await sb7(env, "inbox_messages", {
    method: "POST",
    body: JSON.stringify({
      org_id: org.id,
      conv_id: convId,
      direction: "in",
      author: "contact",
      /* Already in our hands, so 'delivered' rather than 'sent' — this
         message did not travel over a platform that could still drop it. */
      state: "delivered",
      body: `${want}

${note}`.trim(),
      meta: { name, page: page || null, source: "book-form" }
    })
  }).catch(() => null);
  await sb7(env, `inbox_conversations?id=eq.${encodeURIComponent(convId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ last_at: (/* @__PURE__ */ new Date()).toISOString(), status: "open" })
  }).catch(() => null);
  return { contactId, convId };
}
__name(upsertConversation, "upsertConversation");
async function notifyTargets(env, org) {
  const targets = /* @__PURE__ */ new Set();
  const configured5 = org.settings?.notify_email;
  if (configured5) String(configured5).split(",").map((s) => s.trim()).filter(Boolean).forEach((e) => targets.add(e));
  const owners = await sb7(
    env,
    `org_members?org_id=eq.${encodeURIComponent(org.id)}&role=eq.owner&select=profile_id`
  ).catch(() => []);
  for (const owner of owners || []) {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(owner.profile_id)}`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
    }).catch(() => null);
    if (!res || !res.ok) continue;
    const user4 = await res.json().catch(() => null);
    if (user4?.email) targets.add(user4.email);
  }
  return [...targets];
}
__name(notifyTargets, "notifyTargets");
async function senderFor(env, org) {
  const rows = await sb7(
    env,
    `out_sender_identities?org_id=eq.${encodeURIComponent(org.id)}&provider=eq.resend&verified=is.true&select=from_name,from_email&limit=1`
  ).catch(() => []);
  if (rows?.[0]) return rows[0];
  return env.NOTIFY_FROM ? { from_name: "McCluster", from_email: env.NOTIFY_FROM } : null;
}
__name(senderFor, "senderFor");
function plainText({ org, name, email, want, note, page }) {
  return [
    `New inquiry for ${org.name}.`,
    "",
    `From:  ${name} <${email}>`,
    `About: ${want}`,
    page ? `Page:  ${page}` : null,
    "",
    note || "(no message)",
    "",
    "\u2014",
    "Reply straight to this email to answer them."
  ].filter((line) => line !== null).join("\n");
}
__name(plainText, "plainText");
async function recordSend(env, { orgId, convId, target, body, state, error, dedupeKey }) {
  await sb7(env, "inbox_outbound", {
    method: "POST",
    body: JSON.stringify({
      org_id: orgId,
      conv_id: convId || null,
      channel: "email",
      as_kind: "notification",
      target_id: target,
      body,
      state,
      attempts: 1,
      last_error: error ? String(error).slice(0, 500) : null,
      sent_at: state === "sent" ? (/* @__PURE__ */ new Date()).toISOString() : null,
      dedupe_key: dedupeKey
    })
  }).catch(() => null);
}
__name(recordSend, "recordSend");
async function notifyOwners(env, org, lead, convId) {
  if (!env.RESEND_API_KEY) return { notified: 0, reason: "no email provider configured" };
  const targets = await notifyTargets(env, org);
  if (!targets.length) return { notified: 0, reason: "no owner or notify_email for this client" };
  const from = await senderFor(env, org);
  if (!from) return { notified: 0, reason: "no verified sender address" };
  const body = plainText({ org, ...lead });
  let notified = 0;
  for (const target of targets) {
    const dedupeKey = `inquiry:${lead.leadId || convId || lead.email}:${target}`;
    try {
      const res = await fetch(RESEND_API, {
        method: "POST",
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: `${from.from_name} <${from.from_email}>`,
          to: [target],
          reply_to: lead.email,
          subject: `New ${lead.want.toLowerCase()} inquiry \u2014 ${lead.name}`,
          text: body
        })
      });
      if (!res.ok) {
        await recordSend(env, { orgId: org.id, convId, target, body, state: "failed", error: await res.text(), dedupeKey });
        continue;
      }
      notified += 1;
      await recordSend(env, { orgId: org.id, convId, target, body, state: "sent", dedupeKey });
    } catch (error) {
      await recordSend(env, { orgId: org.id, convId, target, body, state: "failed", error: error.message, dedupeKey });
    }
  }
  return { notified };
}
__name(notifyOwners, "notifyOwners");

// src/connect.js
function sbHeaders9(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
    ...extra
  };
}
__name(sbHeaders9, "sbHeaders");
async function sb8(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: sbHeaders9(env, init.headers || {})
  });
  const text2 = await res.text();
  let data = null;
  try {
    data = text2 ? JSON.parse(text2) : null;
  } catch {
    data = text2;
  }
  if (!res.ok) {
    throw Object.assign(new Error(typeof data === "string" ? data : data?.message || "Database request failed"), {
      status: res.status
    });
  }
  return data;
}
__name(sb8, "sb");
function livemode(env) {
  return String(env.STRIPE_SECRET_KEY || "").startsWith("sk_live");
}
__name(livemode, "livemode");
async function currentUser(req, env) {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization }
  });
  return res.ok ? res.json() : null;
}
__name(currentUser, "currentUser");
async function orgBySlug2(env, slug) {
  if (!slug) return null;
  const rows = await sb8(env, `orgs?slug=eq.${encodeURIComponent(slug)}&enabled=eq.true&select=id,slug,name,kind`);
  return rows?.[0] || null;
}
__name(orgBySlug2, "orgBySlug");
async function requireOrgRole(req, env, slug, roles = ["owner"]) {
  const user4 = await currentUser(req, env);
  if (!user4) throw Object.assign(new Error("Authentication required"), { status: 401 });
  const org = await orgBySlug2(env, slug);
  if (!org) throw Object.assign(new Error("Unknown client org"), { status: 404 });
  const rows = await sb8(
    env,
    `org_members?org_id=eq.${encodeURIComponent(org.id)}&profile_id=eq.${encodeURIComponent(user4.id)}&select=role`
  );
  const role = rows?.[0]?.role;
  if (!role || !roles.includes(role)) {
    throw Object.assign(new Error("You do not have that permission on this client"), { status: 403 });
  }
  return { user: user4, org, role };
}
__name(requireOrgRole, "requireOrgRole");
async function railFor(env, orgId) {
  const rows = await sb8(
    env,
    `org_stripe_accounts?org_id=eq.${encodeURIComponent(orgId)}&livemode=is.${livemode(env)}&select=*`
  );
  return rows?.[0] || null;
}
__name(railFor, "railFor");
async function patchRail(env, orgId, patch3) {
  const rows = await sb8(
    env,
    `org_stripe_accounts?org_id=eq.${encodeURIComponent(orgId)}&livemode=is.${livemode(env)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...patch3, updated_at: (/* @__PURE__ */ new Date()).toISOString() })
    }
  );
  return rows?.[0] || null;
}
__name(patchRail, "patchRail");
function statusFor(account) {
  if (!account) return "not_started";
  if (connectedAccountReady(account)) return "ready";
  if (account.requirements?.disabled_reason) return "restricted";
  return account.details_submitted ? "restricted" : "onboarding";
}
__name(statusFor, "statusFor");
function railPatchFromAccount(account) {
  return {
    stripe_account_id: account.id,
    charges_enabled: Boolean(account.charges_enabled),
    payouts_enabled: Boolean(account.payouts_enabled),
    details_submitted: Boolean(account.details_submitted),
    onboarding_status: statusFor(account),
    requirements: account.requirements || {},
    last_synced_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
__name(railPatchFromAccount, "railPatchFromAccount");
function publicRail(rail) {
  if (!rail) return { connected: false, ready: false, onboarding_status: "not_started" };
  return {
    connected: Boolean(rail.stripe_account_id),
    ready: rail.onboarding_status === "ready",
    onboarding_status: rail.onboarding_status,
    account_id: rail.stripe_account_id,
    charges_enabled: rail.charges_enabled,
    payouts_enabled: rail.payouts_enabled,
    details_submitted: rail.details_submitted,
    /* Stripe's own words for what is still outstanding. Paraphrasing this
       is how a client ends up staring at "pending" for a week. */
    requirements: {
      currently_due: rail.requirements?.currently_due || [],
      past_due: rail.requirements?.past_due || [],
      disabled_reason: rail.requirements?.disabled_reason || null
    },
    livemode: rail.livemode,
    last_synced_at: rail.last_synced_at
  };
}
__name(publicRail, "publicRail");
async function createClientAccount(env, { org, email, productDescription, url }) {
  return stripeRequest(env, "accounts", {
    type: "express",
    country: "US",
    email: email || void 0,
    business_profile: {
      name: org.name || void 0,
      product_description: productDescription || void 0,
      url: url || void 0
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    },
    metadata: {
      mccluster_org_id: org.id,
      mccluster_org_slug: org.slug
    }
  });
}
__name(createClientAccount, "createClientAccount");
async function alreadyProcessed(env, event) {
  try {
    await sb8(env, "stripe_events", {
      method: "POST",
      body: JSON.stringify({
        event_id: event.id,
        event_type: event.type,
        stripe_account_id: event.account || null
      })
    });
    return false;
  } catch (error) {
    if (error.status === 409) return true;
    throw error;
  }
}
__name(alreadyProcessed, "alreadyProcessed");
async function handleEvent(env, event) {
  if (await alreadyProcessed(env, event)) return { handled: false, reason: "duplicate" };
  if (event.type === "account.updated") {
    const account = event.data?.object;
    if (!account?.id) return { handled: false, reason: "no account" };
    const rows = await sb8(
      env,
      `org_stripe_accounts?stripe_account_id=eq.${encodeURIComponent(account.id)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ ...railPatchFromAccount(account), updated_at: (/* @__PURE__ */ new Date()).toISOString() })
      }
    );
    if (!rows?.length) return { handled: false, reason: "account not registered to a client" };
    return { handled: true, type: event.type, org_id: rows[0].org_id };
  }
  return { handled: false, reason: "unhandled event type" };
}
__name(handleEvent, "handleEvent");
var connect_default = {
  async fetch(request, env, url, reply7, fail7, logEvent2) {
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/v1/stripe/webhook" && request.method === "POST") {
      const raw = await request.text();
      let event;
      try {
        event = await verifyStripeWebhook(
          raw,
          request.headers.get("stripe-signature"),
          env.STRIPE_CONNECT_WEBHOOK_SECRET || env.STRIPE_WEBHOOK_SECRET
        );
      } catch (error) {
        return fail7(request, env, error.message || "Invalid Stripe signature", 400);
      }
      const result2 = await handleEvent(env, event);
      return reply7(request, env, { received: true, ...result2 });
    }
    if (path === "/v1/inquiries" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const org = await orgBySlug2(env, body.org);
      if (!org) return fail7(request, env, "Unknown client org", 404);
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim();
      if (!name || !email) return fail7(request, env, "name and email are required");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail7(request, env, "A valid email is required");
      if (name.length > 200 || email.length > 320) return fail7(request, env, "name or email is too long");
      const want = String(body.want || "").slice(0, 200);
      const note = String(body.note || "").slice(0, 4e3);
      const page = String(body.page || "").slice(0, 500);
      const rows = await sb8(env, "leads?select=id,at", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          org_id: org.id,
          name,
          email,
          /* `want` is the service asked for. It is stored as free text on
             purpose: Esmer's service list is not settled, and a check
             constraint on a list nobody has approved would reject real
             inquiries. */
          want,
          note,
          page,
          source: String(body.source || "esmer-book").slice(0, 100),
          medium: body.medium ? String(body.medium).slice(0, 100) : null,
          campaign: body.campaign ? String(body.campaign).slice(0, 100) : null
        })
      });
      const lead = { leadId: rows?.[0]?.id, name, email, want, note, page };
      let thread = null;
      let notice = { notified: 0, reason: "not attempted" };
      try {
        thread = await upsertConversation(env, org, lead);
        notice = await notifyOwners(env, org, lead, thread?.convId);
      } catch (error) {
        logEvent2("error", { at: "inquiry-delivery", org: org.slug, message: error.message });
      }
      return reply7(request, env, {
        received: true,
        at: rows?.[0]?.at || (/* @__PURE__ */ new Date()).toISOString(),
        notified: notice.notified > 0
      }, 201);
    }
    if (path === "/v1/account/start" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const org = await orgBySlug2(env, body.org);
      if (!org) return fail7(request, env, "Unknown client org", 404);
      const email = String(body.email || "").trim();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 320) {
        return fail7(request, env, "A valid email is required");
      }
      const res = await fetch(`${env.SUPABASE_URL}/auth/v1/otp`, {
        method: "POST",
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, "content-type": "application/json" },
        body: JSON.stringify({
          email,
          create_user: true,
          data: { source: "inquiry", org_slug: org.slug }
        })
      });
      if (!res.ok) {
        logEvent2("error", { at: "account-start", org: org.slug, status: res.status });
        return fail7(request, env, "Could not send a sign-in link just now", 503);
      }
      return reply7(request, env, { sent: true });
    }
    if (path === "/v1/connect/status" && request.method === "GET") {
      const { org } = await requireOrgRole(request, env, url.searchParams.get("org"), ["owner", "staff", "viewer"]);
      let rail = await railFor(env, org.id);
      if (rail?.stripe_account_id && stripeConfigured(env)) {
        const account = await retrieveConnectedAccount(env, rail.stripe_account_id);
        rail = await patchRail(env, org.id, railPatchFromAccount(account)) || rail;
      }
      return reply7(request, env, { org: { slug: org.slug, name: org.name }, stripe: publicRail(rail) });
    }
    if (path === "/v1/connect/accounts" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const { org, user: user4 } = await requireOrgRole(request, env, body.org);
      if (!stripeConfigured(env)) return fail7(request, env, "Stripe is not configured on this Worker", 503);
      let rail = await railFor(env, org.id);
      if (!rail) return fail7(request, env, "This client has no Connect rail provisioned", 409);
      if (rail.stripe_account_id) {
        return reply7(request, env, { org: { slug: org.slug }, stripe: publicRail(rail) });
      }
      const account = await createClientAccount(env, {
        org,
        email: body.email || user4.email,
        productDescription: body.product_description,
        url: body.url
      });
      rail = await patchRail(env, org.id, railPatchFromAccount(account));
      return reply7(request, env, { org: { slug: org.slug }, stripe: publicRail(rail) }, 201);
    }
    if (path === "/v1/connect/onboarding-link" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const { org } = await requireOrgRole(request, env, body.org);
      if (!stripeConfigured(env)) return fail7(request, env, "Stripe is not configured on this Worker", 503);
      const rail = await railFor(env, org.id);
      if (!rail?.stripe_account_id) return fail7(request, env, "Create the connected account first", 409);
      const trusted = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
      const fallback = env.PUBLIC_APP_URL || "https://matthew.mccluster.org";
      const safeUrl = /* @__PURE__ */ __name((candidate) => {
        if (!candidate) return null;
        try {
          const parsed = new URL(candidate);
          return trusted.includes(parsed.origin) ? parsed.toString() : null;
        } catch {
          return null;
        }
      }, "safeUrl");
      const link = await createAccountLink(env, rail.stripe_account_id, {
        returnUrl: safeUrl(body.return_url) || `${fallback}/control.html?connect=return&org=${encodeURIComponent(org.slug)}`,
        refreshUrl: safeUrl(body.refresh_url) || `${fallback}/control.html?connect=refresh&org=${encodeURIComponent(org.slug)}`
      });
      if (rail.onboarding_status === "not_started") {
        await patchRail(env, org.id, { onboarding_status: "onboarding" });
      }
      return reply7(request, env, { url: link.url, expires_at: link.expires_at });
    }
    return null;
  }
};

// src/media/router.js
init_modules_watch_stub();

// src/media/fal.js
init_modules_watch_stub();
var import_client = __toESM(require_src(), 1);
var FAL_JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";
var FAL_BILLING_EVENTS_URL = "https://api.fal.ai/v1/models/billing-events";
var FAL_WEBHOOK_MAX_AGE_SECONDS = 300;
var FAL_JWKS_CACHE_MS = 6 * 60 * 60 * 1e3;
var jwksCache2 = { keys: null, expiresAt: 0 };
function configured4(env) {
  return Boolean(env.FAL_KEY);
}
__name(configured4, "configured");
function setup(env) {
  if (!configured4(env)) throw Object.assign(new Error("fal gateway is not configured"), { status: 503 });
  import_client.fal.config({ credentials: env.FAL_KEY });
}
__name(setup, "setup");
function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
__name(bytesToHex, "bytesToHex");
function hexToBytes(value) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < value.length; i += 2) out[i / 2] = Number.parseInt(value.slice(i, i + 2), 16);
  return out;
}
__name(hexToBytes, "hexToBytes");
function base64UrlToBytes2(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
__name(base64UrlToBytes2, "base64UrlToBytes");
async function falJwks() {
  const now = Date.now();
  if (jwksCache2.keys && jwksCache2.expiresAt > now) return jwksCache2.keys;
  const res = await fetch(FAL_JWKS_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw Object.assign(new Error("Unable to load fal webhook verification keys"), { status: 503 });
  const body = await res.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  if (!keys.length) throw Object.assign(new Error("fal webhook verification keys are unavailable"), { status: 503 });
  jwksCache2 = { keys, expiresAt: now + FAL_JWKS_CACHE_MS };
  return keys;
}
__name(falJwks, "falJwks");
async function submitFal(env, modelId, input, options = {}) {
  setup(env);
  const submitOptions = { input };
  if (options.webhookUrl) submitOptions.webhookUrl = options.webhookUrl;
  const result2 = await import_client.fal.queue.submit(modelId, submitOptions);
  return { request_id: result2.request_id || result2.requestId };
}
__name(submitFal, "submitFal");
async function statusFal(env, modelId, requestId) {
  setup(env);
  return import_client.fal.queue.status(modelId, { requestId, logs: true });
}
__name(statusFal, "statusFal");
async function resultFal(env, modelId, requestId) {
  setup(env);
  const result2 = await import_client.fal.queue.result(modelId, { requestId });
  return { data: result2.data, request_id: result2.requestId || requestId };
}
__name(resultFal, "resultFal");
async function billingEventsFal(env, requestIds) {
  const ids = [...new Set((requestIds || []).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 50);
  if (!ids.length) return { available: true, events: [] };
  if (!env.FAL_ADMIN_KEY) {
    return { available: false, retryable: false, reason: "fal_admin_key_not_configured", events: [] };
  }
  const url = new URL(FAL_BILLING_EVENTS_URL);
  ids.forEach((id) => url.searchParams.append("request_id", id));
  url.searchParams.set("limit", String(Math.max(ids.length, 1)));
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Key ${env.FAL_ADMIN_KEY}`
    }
  });
  const text2 = await res.text();
  let body = null;
  try {
    body = text2 ? JSON.parse(text2) : null;
  } catch {
    body = { raw: text2 };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      available: false,
      retryable: false,
      reason: "fal_admin_key_rejected",
      status: res.status,
      detail: body,
      events: []
    };
  }
  if (res.status === 429) {
    return {
      available: false,
      retryable: true,
      reason: "fal_billing_rate_limited",
      status: res.status,
      detail: body,
      events: []
    };
  }
  if (!res.ok) {
    throw Object.assign(new Error("Unable to query fal billing events"), {
      status: 503,
      detail: { provider_status: res.status, provider_body: body }
    });
  }
  return {
    available: true,
    retryable: false,
    events: Array.isArray(body?.billing_events) ? body.billing_events : [],
    next_cursor: body?.next_cursor || null,
    has_more: Boolean(body?.has_more)
  };
}
__name(billingEventsFal, "billingEventsFal");
async function verifyFalWebhook(request) {
  const requestId = request.headers.get("x-fal-webhook-request-id");
  const userId = request.headers.get("x-fal-webhook-user-id");
  const timestamp3 = request.headers.get("x-fal-webhook-timestamp");
  const signatureHex = request.headers.get("x-fal-webhook-signature");
  if (!requestId || !userId || !timestamp3 || !signatureHex) {
    throw Object.assign(new Error("Missing fal webhook signature headers"), { status: 401 });
  }
  const timestampSeconds = Number.parseInt(timestamp3, 10);
  const nowSeconds = Math.floor(Date.now() / 1e3);
  if (!Number.isFinite(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > FAL_WEBHOOK_MAX_AGE_SECONDS) {
    throw Object.assign(new Error("Stale or invalid fal webhook timestamp"), { status: 401 });
  }
  const rawBody = new Uint8Array(await request.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", rawBody));
  const message = new TextEncoder().encode(`${requestId}
${userId}
${timestamp3}
${bytesToHex(digest)}`);
  const signature = hexToBytes(signatureHex);
  if (!signature) throw Object.assign(new Error("Invalid fal webhook signature encoding"), { status: 401 });
  const keys = await falJwks();
  let verified2 = false;
  for (const jwk of keys) {
    if (typeof jwk?.x !== "string") continue;
    try {
      const key = await crypto.subtle.importKey("raw", base64UrlToBytes2(jwk.x), { name: "Ed25519" }, false, ["verify"]);
      if (await crypto.subtle.verify({ name: "Ed25519" }, key, signature, message)) {
        verified2 = true;
        break;
      }
    } catch {
    }
  }
  if (!verified2) throw Object.assign(new Error("Invalid fal webhook signature"), { status: 401 });
  try {
    return JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw Object.assign(new Error("Invalid fal webhook JSON"), { status: 400 });
  }
}
__name(verifyFalWebhook, "verifyFalWebhook");
function normalizeFalStatus(raw) {
  const value = String(raw?.status || "").toUpperCase();
  if (value === "COMPLETED") return "completed";
  if (value === "IN_PROGRESS") return "running";
  if (value === "IN_QUEUE") return "queued";
  if (value === "ERROR" || value === "FAILED") return "failed";
  return "queued";
}
__name(normalizeFalStatus, "normalizeFalStatus");
function collectAssetCandidates(value, path = "", out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectAssetCandidates(item, `${path}[${i}]`, out));
    return out;
  }
  if (typeof value !== "object") return out;
  if (typeof value.url === "string" && /^https?:\/\//i.test(value.url)) {
    const mime = value.content_type || value.mime_type || value.mimeType || null;
    const lower = `${path} ${mime || ""} ${value.url}`.toLowerCase();
    let assetType = "file";
    if (/image|\.png|\.jpe?g|\.webp|\.gif/.test(lower)) assetType = "image";
    else if (/video|\.mp4|\.webm|\.mov/.test(lower)) assetType = "video";
    else if (/audio|\.wav|\.mp3|\.m4a|\.ogg/.test(lower)) assetType = "audio";
    out.push({
      asset_type: assetType,
      role: path || "result",
      url: value.url,
      mime_type: mime,
      width: Number.isFinite(value.width) ? value.width : null,
      height: Number.isFinite(value.height) ? value.height : null,
      duration_seconds: Number.isFinite(value.duration) ? value.duration : null,
      metadata: value
    });
  }
  for (const [key, child] of Object.entries(value)) {
    if (key !== "url") collectAssetCandidates(child, path ? `${path}.${key}` : key, out);
  }
  return out;
}
__name(collectAssetCandidates, "collectAssetCandidates");

// src/media/pricing.js
init_modules_watch_stub();
var FAL_IMAGE_PRESET_MEGAPIXELS = Object.freeze({
  square_hd: 1024 * 1024 / 1e6,
  square: 512 * 512 / 1e6,
  portrait_4_3: 768 * 1024 / 1e6,
  portrait_16_9: 576 * 1024 / 1e6,
  landscape_4_3: 1024 * 768 / 1e6,
  landscape_16_9: 1024 * 576 / 1e6
});
function asFiniteNumber(value) {
  if (value === null || value === void 0 || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
__name(asFiniteNumber, "asFiniteNumber");
function positive(value) {
  const number = asFiniteNumber(value);
  return number !== null && number >= 0 ? number : null;
}
__name(positive, "positive");
function outputCount(input, hint) {
  const field = hint.count_field;
  if (!field) return 1;
  const raw = positive(input?.[field] ?? hint.default_count ?? 1);
  if (raw === null || raw < 1) return null;
  return Math.ceil(raw);
}
__name(outputCount, "outputCount");
function imageMegapixels(input, hint) {
  const imageSizeField = hint.image_size_field || "image_size";
  const size = input?.[imageSizeField] ?? hint.default_image_size;
  if (size && typeof size === "object") {
    const width2 = positive(size.width);
    const height2 = positive(size.height);
    if (width2 && height2) return width2 * height2 / 1e6;
  }
  const width = positive(input?.[hint.width_field || "width"]);
  const height = positive(input?.[hint.height_field || "height"]);
  if (width && height) return width * height / 1e6;
  if (typeof size === "string") {
    const customPresets = hint.preset_megapixels || {};
    if (customPresets[size] !== void 0) return positive(customPresets[size]);
    if (FAL_IMAGE_PRESET_MEGAPIXELS[size] !== void 0) return FAL_IMAGE_PRESET_MEGAPIXELS[size];
    return null;
  }
  return positive(hint.default_output_megapixels);
}
__name(imageMegapixels, "imageMegapixels");
function durationSeconds(input, hint) {
  const field = hint.duration_field || "duration";
  return positive(input?.[field] ?? hint.default_duration_seconds);
}
__name(durationSeconds, "durationSeconds");
function perSecondRate(input, hint) {
  if (hint.rate_selector === "audio") {
    const audioField = hint.audio_field || "generate_audio";
    const audioEnabled = input?.[audioField] ?? hint.default_audio_enabled ?? false;
    const voiceField = hint.voice_field || "voice_ids";
    const voice = input?.[voiceField];
    const hasVoice = Array.isArray(voice) ? voice.length > 0 : Boolean(voice);
    if (audioEnabled && hasVoice && hint.rates_cents_per_second?.voice_control !== void 0) {
      return positive(hint.rates_cents_per_second.voice_control);
    }
    const key = audioEnabled ? "audio_on" : "audio_off";
    return positive(hint.rates_cents_per_second?.[key]);
  }
  if (hint.rate_selector === "field") {
    const field = hint.rate_field;
    const key = String(input?.[field] ?? hint.default_rate_key ?? "");
    return positive(hint.rates_cents_per_second?.[key]);
  }
  return positive(hint.cents_per_second);
}
__name(perSecondRate, "perSecondRate");
function money(centsExact, detail = {}) {
  if (!Number.isFinite(centsExact) || centsExact < 0) return null;
  return {
    estimated_cost_cents: Math.ceil(centsExact),
    estimated_cost_cents_exact: centsExact,
    estimated_cost_usd_micros: Math.ceil(centsExact * 1e4),
    ...detail
  };
}
__name(money, "money");
function unitPriceMicrosFromCents(cents) {
  const value = positive(cents);
  return value === null ? null : Math.ceil(value * 1e4);
}
__name(unitPriceMicrosFromCents, "unitPriceMicrosFromCents");
function estimateModelCost(model, input = {}) {
  const hint = model?.cost_hint;
  if (!hint || typeof hint !== "object" || !hint.kind) {
    return { available: false, reason: "model_pricing_not_configured", pricing_snapshot: hint || {} };
  }
  const pricingSnapshot = {
    ...hint,
    provider: model.provider,
    provider_model_id: model.provider_model_id,
    model_id: model.id,
    captured_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (hint.preflight === "unavailable") {
    return { available: false, reason: hint.unavailable_reason || "provider_pricing_not_preflightable", pricing_snapshot: pricingSnapshot };
  }
  if (hint.kind === "fixed") {
    const cents = positive(hint.cents_per_generation);
    const result2 = cents === null ? null : money(cents, {
      units: 1,
      unit: "generation",
      unit_price_usd_micros: unitPriceMicrosFromCents(cents)
    });
    return result2 ? { available: true, ...result2, pricing_snapshot: pricingSnapshot } : { available: false, reason: "invalid_fixed_price", pricing_snapshot: pricingSnapshot };
  }
  if (hint.kind === "per_second") {
    const seconds = durationSeconds(input, hint);
    const rate = perSecondRate(input, hint);
    if (seconds === null || rate === null) {
      return { available: false, reason: "pricing_requires_duration_or_rate_selector", pricing_snapshot: pricingSnapshot };
    }
    return {
      available: true,
      ...money(seconds * rate, {
        units: seconds,
        unit: "second",
        unit_price_cents: rate,
        unit_price_usd_micros: unitPriceMicrosFromCents(rate)
      }),
      pricing_snapshot: pricingSnapshot
    };
  }
  if (hint.kind === "per_output_megapixel") {
    const megapixels = imageMegapixels(input, hint);
    const count = outputCount(input, hint);
    const rate = positive(hint.cents_per_megapixel);
    if (megapixels === null || count === null || rate === null) {
      return { available: false, reason: "pricing_requires_output_dimensions_or_count", pricing_snapshot: pricingSnapshot };
    }
    const megapixelsPerOutput = hint.round_megapixels === "ceil" ? Math.ceil(megapixels) : megapixels;
    const billedMegapixels = megapixelsPerOutput * count;
    return {
      available: true,
      ...money(billedMegapixels * rate, {
        units: billedMegapixels,
        unit: "output_megapixel",
        unit_price_cents: rate,
        unit_price_usd_micros: unitPriceMicrosFromCents(rate),
        output_count: count,
        megapixels_per_output: megapixelsPerOutput
      }),
      pricing_snapshot: pricingSnapshot
    };
  }
  if (hint.kind === "tiered_output_megapixel") {
    const megapixels = imageMegapixels(input, hint);
    const count = outputCount(input, hint);
    const first = positive(hint.first_megapixel_cents);
    const additional = positive(hint.additional_megapixel_cents);
    if (megapixels === null || count === null || first === null || additional === null) {
      return { available: false, reason: "pricing_requires_output_dimensions_or_count", pricing_snapshot: pricingSnapshot };
    }
    const billedPerOutput = Math.max(1, Math.ceil(megapixels));
    const centsPerOutput = first + Math.max(0, billedPerOutput - 1) * additional;
    return {
      available: true,
      ...money(centsPerOutput * count, {
        units: billedPerOutput * count,
        unit: "output_megapixel",
        output_count: count,
        megapixels_per_output: billedPerOutput,
        pricing_formula: "tiered"
      }),
      pricing_snapshot: pricingSnapshot
    };
  }
  return { available: false, reason: "unsupported_pricing_formula", pricing_snapshot: pricingSnapshot };
}
__name(estimateModelCost, "estimateModelCost");

// src/social/security.js
init_modules_watch_stub();
var UUID_RE2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var INSTAGRAM_ENV_RE = /^SOCIAL_IG_[A-Z0-9_]+_ACCESS_TOKEN$/;
function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}
__name(httpError, "httpError");
function requireOrgId(value) {
  const orgId = String(value || "").trim();
  if (!orgId) throw httpError("org_id is required for tenant-scoped operations", 400);
  if (!UUID_RE2.test(orgId)) throw httpError("org_id must be a UUID", 400);
  return orgId;
}
__name(requireOrgId, "requireOrgId");
function requireOrgRole2(membership, allowedRoles = ["owner"]) {
  if (!membership || !allowedRoles.includes(membership.role)) {
    throw httpError(`Social operation requires role: ${allowedRoles.join(" or ")}`, 403);
  }
  return membership;
}
__name(requireOrgRole2, "requireOrgRole");
function parseSocialCredentialRef(platform, ref) {
  if (!ref) return null;
  if (String(platform || "").toLowerCase() !== "instagram") return null;
  const value = String(ref).trim();
  if (value.startsWith("vault:")) {
    const id = value.slice("vault:".length);
    return UUID_RE2.test(id) ? { kind: "vault", id } : null;
  }
  const name = value.startsWith("env:") ? value.slice("env:".length) : value;
  if (!INSTAGRAM_ENV_RE.test(name)) return null;
  return { kind: "env", name };
}
__name(parseSocialCredentialRef, "parseSocialCredentialRef");
function credentialRefForConfiguredChannel(platform, channel) {
  if (!channel) return null;
  if (String(platform || "").toLowerCase() !== "instagram") return null;
  if (channel.secret_id) return `vault:${channel.secret_id}`;
  if (channel.token_env) {
    const ref = `env:${channel.token_env}`;
    if (!parseSocialCredentialRef(platform, ref)) {
      throw httpError("Configured Instagram credential binding is not allowlisted", 500);
    }
    return ref;
  }
  return null;
}
__name(credentialRefForConfiguredChannel, "credentialRefForConfiguredChannel");

// src/lib/capabilities.js
init_modules_watch_stub();
var GRANT_TTL_MS = 6e4;
var cache = null;
var inFlight = null;
async function fetchGrants(env) {
  const url = `${env.SUPABASE_URL}/rest/v1/control_role_capabilities?select=role,capability,allowed`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      accept: "application/json"
    }
  });
  if (!res.ok) {
    throw Object.assign(new Error("Authorization is temporarily unavailable"), { status: 503 });
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) {
    throw Object.assign(new Error("Authorization is temporarily unavailable"), { status: 503 });
  }
  const grants = /* @__PURE__ */ new Map();
  for (const row of rows) grants.set(`${row.role} ${row.capability}`, row.allowed === true);
  return { grants, loadedAt: Date.now() };
}
__name(fetchGrants, "fetchGrants");
async function grantTable(env) {
  if (cache && Date.now() - cache.loadedAt < GRANT_TTL_MS) return cache;
  if (!inFlight) {
    inFlight = fetchGrants(env).then((table) => {
      cache = table;
      return table;
    }).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
__name(grantTable, "grantTable");
async function requireCapability(env, membership, capability) {
  if (!capability) throw new Error("requireCapability called with no capability");
  const role = membership?.role;
  if (!role) throw Object.assign(new Error("No organization membership found"), { status: 403 });
  const { grants } = await grantTable(env);
  if (grants.get(`${role} ${capability}`) !== true) {
    throw Object.assign(
      new Error(`Your role (${role}) does not include ${capability}`),
      { status: 403 }
    );
  }
  return membership;
}
__name(requireCapability, "requireCapability");

// src/media/router.js
function headers2(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json"
  };
}
__name(headers2, "headers");
async function db2(env, path, options = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers2(env), ...options.headers || {} }
  });
  const text2 = await res.text();
  let data = null;
  try {
    data = text2 ? JSON.parse(text2) : null;
  } catch {
    data = text2;
  }
  if (!res.ok) throw Object.assign(new Error("Media database request failed"), { status: res.status, detail: data });
  return data;
}
__name(db2, "db");
async function rpc2(env, name, payload) {
  return db2(env, `rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
__name(rpc2, "rpc");
async function getOrg(env, userId, requestedOrgId) {
  const orgId = requireOrgId(requestedOrgId);
  const rows = await db2(env, `org_members?org_id=eq.${encodeURIComponent(orgId)}&profile_id=eq.${encodeURIComponent(userId)}&select=org_id,role&limit=1`);
  if (!rows?.length) throw Object.assign(new Error("You are not a member of that organization"), { status: 403 });
  return rows[0];
}
__name(getOrg, "getOrg");
async function modelById(env, id) {
  const rows = await db2(env, `media_models?id=eq.${encodeURIComponent(id)}&enabled=eq.true&select=*`);
  return rows?.[0] || null;
}
__name(modelById, "modelById");
async function jobById(env, id, orgId) {
  const rows = await db2(env, `media_jobs?id=eq.${encodeURIComponent(id)}&org_id=eq.${encodeURIComponent(orgId)}&select=*`);
  return rows?.[0] || null;
}
__name(jobById, "jobById");
async function jobByProviderRequestId(env, requestId) {
  const rows = await db2(env, `media_jobs?provider=eq.fal&provider_request_id=eq.${encodeURIComponent(requestId)}&select=*&limit=1`);
  return rows?.[0] || null;
}
__name(jobByProviderRequestId, "jobByProviderRequestId");
async function patchJob(env, id, values) {
  const rows = await db2(env, `media_jobs?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ ...values, updated_at: (/* @__PURE__ */ new Date()).toISOString() })
  });
  return rows?.[0] || null;
}
__name(patchJob, "patchJob");
async function releaseReservation(env, jobId, reason) {
  return rpc2(env, "media_release_cost_reservation", {
    p_job_id: jobId,
    p_reason: reason || null
  });
}
__name(releaseReservation, "releaseReservation");
async function saveAssets(env, orgId, jobId, result2) {
  const candidates = collectAssetCandidates(result2);
  const unique = [...new Map(candidates.map((a) => [a.url, a])).values()];
  if (!unique.length) return [];
  const existing = await db2(env, `media_assets?job_id=eq.${encodeURIComponent(jobId)}&select=url`);
  const existingUrls = new Set((existing || []).map((asset) => asset.url));
  const body = unique.filter((asset) => !existingUrls.has(asset.url)).map((asset) => ({ ...asset, org_id: orgId, job_id: jobId }));
  if (!body.length) return [];
  return db2(env, "media_assets", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(body)
  });
}
__name(saveAssets, "saveAssets");
function budgetCents(value) {
  if (value === null || value === void 0) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw Object.assign(new Error("budget_cents must be a non-negative number"), { status: 400 });
  }
  return Math.floor(parsed);
}
__name(budgetCents, "budgetCents");
function estimatePayload(estimate) {
  if (!estimate?.available) return {};
  return {
    estimated_cost_cents: estimate.estimated_cost_cents,
    estimated_cost_cents_exact: estimate.estimated_cost_cents_exact,
    estimated_cost_usd_micros: estimate.estimated_cost_usd_micros,
    units: estimate.units ?? null,
    unit: estimate.unit ?? null,
    unit_price_cents: estimate.unit_price_cents ?? null,
    unit_price_usd_micros: estimate.unit_price_usd_micros ?? null,
    output_count: estimate.output_count ?? null,
    megapixels_per_output: estimate.megapixels_per_output ?? null,
    pricing_formula: estimate.pricing_formula ?? null
  };
}
__name(estimatePayload, "estimatePayload");
function billingEventCostMicros(event) {
  const nano = Number(event?.cost_estimate_nano_usd);
  if (Number.isFinite(nano) && nano >= 0) return Math.ceil(nano / 1e3);
  const total = Number(event?.cost_total);
  if (Number.isFinite(total) && total >= 0) return Math.ceil(total * 1e6);
  return null;
}
__name(billingEventCostMicros, "billingEventCostMicros");
function billingEventUnitPriceMicros(event) {
  const price = Number(event?.unit_price);
  return Number.isFinite(price) && price >= 0 ? Math.ceil(price * 1e6) : null;
}
__name(billingEventUnitPriceMicros, "billingEventUnitPriceMicros");
async function settleFalBillingEvent(env, job, event) {
  const actualCostMicros = billingEventCostMicros(event);
  if (actualCostMicros === null) return { settled: false, reason: "billing_event_missing_cost" };
  const quantity = Number(event?.output_units);
  const estimate = job?.routing?.estimate || {};
  await rpc2(env, "media_record_actual_cost_v2", {
    p_job_id: job.id,
    p_actual_cost_usd_micros: actualCostMicros,
    p_quantity: Number.isFinite(quantity) ? quantity : null,
    p_unit: estimate.unit || null,
    p_unit_price_usd_micros: billingEventUnitPriceMicros(event),
    p_source: "fal-billing-events",
    p_raw_provider_usage: event || {},
    p_occurred_at: event?.timestamp || null
  });
  return { settled: true, actual_cost_usd_micros: actualCostMicros };
}
__name(settleFalBillingEvent, "settleFalBillingEvent");
async function reconcileFalJobs(env, jobs) {
  const candidates = (jobs || []).filter((job) => job?.provider === "fal" && job?.provider_request_id && job?.actual_cost_cents === null);
  if (!candidates.length) return { configured: Boolean(env.FAL_ADMIN_KEY), checked: 0, settled: 0, pending: 0 };
  const billing = await billingEventsFal(env, candidates.map((job) => job.provider_request_id));
  if (!billing.available) {
    return {
      configured: Boolean(env.FAL_ADMIN_KEY),
      checked: candidates.length,
      settled: 0,
      pending: candidates.length,
      reason: billing.reason,
      retryable: Boolean(billing.retryable)
    };
  }
  const byRequestId = new Map((billing.events || []).map((event) => [String(event.request_id), event]));
  let settled = 0;
  let pending = 0;
  const failures = [];
  for (const job of candidates) {
    const event = byRequestId.get(String(job.provider_request_id));
    if (!event) {
      pending += 1;
      continue;
    }
    try {
      const result2 = await settleFalBillingEvent(env, job, event);
      if (result2.settled) settled += 1;
      else pending += 1;
    } catch (error) {
      failures.push({ job_id: job.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    configured: true,
    checked: candidates.length,
    settled,
    pending: pending + failures.length,
    failures
  };
}
__name(reconcileFalJobs, "reconcileFalJobs");
async function reconcilePendingFalCosts(env, options = {}) {
  if (!env.FAL_ADMIN_KEY) return { configured: false, checked: 0, settled: 0, pending: 0, reason: "fal_admin_key_not_configured" };
  const limit = Math.min(50, Math.max(1, Number(options.limit || 50)));
  const jobs = await db2(env, `media_jobs?provider=eq.fal&status=eq.completed&actual_cost_cents=is.null&provider_request_id=not.is.null&order=completed_at.asc&limit=${limit}&select=*`);
  return reconcileFalJobs(env, jobs || []);
}
__name(reconcilePendingFalCosts, "reconcilePendingFalCosts");
async function reconcileFalJobCost(env, job) {
  const result2 = await reconcileFalJobs(env, [job]);
  return { ...result2, settled_job: result2.settled > 0 ? job.id : null };
}
__name(reconcileFalJobCost, "reconcileFalJobCost");
async function listModels(request, env) {
  const url = new URL(request.url);
  const capability = url.searchParams.get("capability");
  const provider = url.searchParams.get("provider");
  let path = "media_models?enabled=eq.true&order=capability.asc,display_name.asc&select=*";
  if (capability) path += `&capability=eq.${encodeURIComponent(capability)}`;
  if (provider) path += `&provider=eq.${encodeURIComponent(provider)}`;
  return db2(env, path);
}
__name(listModels, "listModels");
async function createGeneration(request, env, user4) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
  const org = await getOrg(env, user4.id, body.org_id);
  await requireCapability(env, org, "media.generate");
  if (!body.model_id) throw Object.assign(new Error("model_id is required"), { status: 400 });
  const model = await modelById(env, body.model_id);
  if (!model) throw Object.assign(new Error("Unknown or disabled media model"), { status: 404 });
  if (model.provider !== "fal") throw Object.assign(new Error("Provider adapter not installed"), { status: 501 });
  const input = { ...body.input || {} };
  if (body.prompt && !input.prompt) input.prompt = body.prompt;
  if (!Object.keys(input).length) throw Object.assign(new Error("input or prompt is required"), { status: 400 });
  const budget = budgetCents(body.budget_cents);
  const budgetUsdMicros = budget === null ? null : budget * 1e4;
  const estimate = estimateModelCost(model, input);
  if (budget !== null && !estimate.available) {
    throw Object.assign(new Error("This model cannot be safely preflighted against a budget yet"), {
      status: 422,
      detail: { model_id: model.id, provider_model_id: model.provider_model_id, reason: estimate.reason }
    });
  }
  if (budgetUsdMicros !== null && estimate.estimated_cost_usd_micros > budgetUsdMicros) {
    throw Object.assign(new Error("Estimated media cost exceeds budget"), {
      status: 422,
      detail: {
        model_id: model.id,
        estimated_cost_cents: estimate.estimated_cost_cents,
        estimated_cost_usd_micros: estimate.estimated_cost_usd_micros,
        budget_cents: budget,
        budget_usd_micros: budgetUsdMicros
      }
    });
  }
  const estimateData = estimatePayload(estimate);
  const created = await rpc2(env, "media_create_budgeted_job_v2", {
    p_org_id: org.org_id,
    p_created_by: user4.id,
    p_provider: model.provider,
    p_provider_model_id: model.provider_model_id,
    p_capability: model.capability,
    p_prompt: body.prompt || input.prompt || null,
    p_input: input,
    p_routing: {
      requested_model_id: model.id,
      requested_by: user4.id,
      strategy: body.strategy || "explicit-model",
      estimate_available: Boolean(estimate.available),
      estimate_reason: estimate.available ? null : estimate.reason
    },
    p_estimated_cost_usd_micros: estimate.available ? estimate.estimated_cost_usd_micros : null,
    p_budget_cents: budget,
    p_pricing_snapshot: estimate.pricing_snapshot || model.cost_hint || {},
    p_estimate: estimateData
  });
  const job = Array.isArray(created) ? created[0] : created;
  if (!job?.id) throw Object.assign(new Error("Media job creation did not return a job"), { status: 500 });
  try {
    const webhookUrl = `${new URL(request.url).origin}/v1/media/webhooks/fal`;
    const submitted = await submitFal(env, model.provider_model_id, input, { webhookUrl });
    return patchJob(env, job.id, {
      provider_request_id: submitted.request_id,
      submitted_at: (/* @__PURE__ */ new Date()).toISOString(),
      provider_status: { ...submitted, delivery: "webhook" },
      status: "queued"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchJob(env, job.id, {
      status: "failed",
      error: { message }
    }).catch(() => null);
    await releaseReservation(env, job.id, `provider submission failed: ${message}`).catch(() => null);
    throw error;
  }
}
__name(createGeneration, "createGeneration");
async function handleFalWebhook(request, env) {
  const webhook = await verifyFalWebhook(request);
  const providerRequestId = webhook?.request_id || webhook?.gateway_request_id;
  if (!providerRequestId) throw Object.assign(new Error("fal webhook is missing request_id"), { status: 400 });
  const job = await jobByProviderRequestId(env, providerRequestId);
  if (!job) return { accepted: true, matched: false, request_id: providerRequestId };
  const falStatus = String(webhook?.status || "").toUpperCase();
  if (falStatus === "ERROR") {
    const failed = await patchJob(env, job.id, {
      status: "failed",
      provider_status: webhook,
      error: {
        message: typeof webhook.error === "string" ? webhook.error : "fal generation failed",
        detail: webhook.payload || null
      }
    });
    await releaseReservation(env, job.id, "fal generation did not produce a successful output").catch(() => null);
    return { accepted: true, matched: true, job_id: failed?.id || job.id, status: "failed" };
  }
  if (falStatus !== "OK") {
    throw Object.assign(new Error("Unsupported fal webhook status"), { status: 400, detail: { status: webhook?.status || null } });
  }
  const result2 = webhook.payload || {};
  const completed = await patchJob(env, job.id, {
    status: "completed",
    result: result2,
    completed_at: job.completed_at || (/* @__PURE__ */ new Date()).toISOString(),
    provider_status: webhook,
    error: null
  });
  await saveAssets(env, job.org_id, job.id, result2);
  const reconciliation = await reconcileFalJobCost(env, completed || job).catch((error) => ({
    configured: Boolean(env.FAL_ADMIN_KEY),
    settled: 0,
    pending: 1,
    reason: error instanceof Error ? error.message : String(error)
  }));
  return {
    accepted: true,
    matched: true,
    job_id: completed?.id || job.id,
    status: "completed",
    cost_reconciliation: reconciliation
  };
}
__name(handleFalWebhook, "handleFalWebhook");
async function getGeneration(request, env, user4, jobId, refresh = true) {
  const url = new URL(request.url);
  const org = await getOrg(env, user4.id, url.searchParams.get("org_id"));
  let job = await jobById(env, jobId, org.org_id);
  if (!job) throw Object.assign(new Error("Media job not found"), { status: 404 });
  if (refresh && job.provider === "fal" && job.provider_request_id && !["completed", "failed", "cancelled"].includes(job.status)) {
    const raw = await statusFal(env, job.provider_model_id, job.provider_request_id);
    const status = normalizeFalStatus(raw);
    job = await patchJob(env, job.id, { status, provider_status: raw });
  }
  if (job.status === "completed" && (!job.result || Object.keys(job.result).length === 0)) {
    const result2 = await resultFal(env, job.provider_model_id, job.provider_request_id);
    job = await patchJob(env, job.id, {
      result: result2.data || {},
      completed_at: (/* @__PURE__ */ new Date()).toISOString(),
      provider_status: { ...job.provider_status || {}, request_id: result2.request_id }
    });
    await saveAssets(env, org.org_id, job.id, result2.data || {});
  }
  if (job.status === "completed" && job.provider === "fal" && job.provider_request_id && job.actual_cost_cents === null) {
    const reconciliation = await reconcileFalJobCost(env, job).catch(() => null);
    if (reconciliation?.settled) job = await jobById(env, job.id, org.org_id) || job;
  }
  const assets = await db2(env, `media_assets?job_id=eq.${encodeURIComponent(job.id)}&order=created_at.asc&select=*`);
  return { job, assets: assets || [] };
}
__name(getGeneration, "getGeneration");

// src/media/orchestrator.js
init_modules_watch_stub();
async function createBakeoff(request, env, user4) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
  const modelIds = Array.isArray(body.model_ids) ? [...new Set(body.model_ids.filter(Boolean))] : [];
  if (modelIds.length < 2) throw Object.assign(new Error("model_ids must contain at least two models"), { status: 400 });
  if (modelIds.length > 5) throw Object.assign(new Error("Bakeoffs are limited to five models per run"), { status: 400 });
  if (!body.input && !body.prompt) throw Object.assign(new Error("input or prompt is required"), { status: 400 });
  const settled = await Promise.allSettled(modelIds.map((modelId) => {
    const synthetic = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        org_id: body.org_id || null,
        model_id: modelId,
        prompt: body.prompt || null,
        input: body.input || {},
        budget_cents: body.budget_cents || null,
        strategy: "bakeoff"
      })
    });
    return createGeneration(synthetic, env, user4);
  }));
  const jobs = [];
  const failures = [];
  settled.forEach((result2, index) => {
    if (result2.status === "fulfilled") jobs.push(result2.value);
    else failures.push({ model_id: modelIds[index], error: result2.reason instanceof Error ? result2.reason.message : String(result2.reason) });
  });
  if (!jobs.length) throw Object.assign(new Error("Every bakeoff submission failed"), { status: 502, detail: failures });
  return { jobs, failures, requested_models: modelIds.length, submitted_models: jobs.length };
}
__name(createBakeoff, "createBakeoff");

// src/media/recommend.js
init_modules_watch_stub();
function headers3(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json"
  };
}
__name(headers3, "headers");
async function db3(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: headers3(env) });
  const text2 = await res.text();
  const data = text2 ? JSON.parse(text2) : null;
  if (!res.ok) throw Object.assign(new Error("Media model lookup failed"), { status: res.status, detail: data });
  return data;
}
__name(db3, "db");
var tierScore = { premium: 40, high: 32, standard: 22, utility: 12 };
async function recommendModels(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
  if (!body.capability) throw Object.assign(new Error("capability is required"), { status: 400 });
  const rows = await db3(env, `media_models?enabled=eq.true&capability=eq.${encodeURIComponent(body.capability)}&select=*`);
  const required = body.required || {};
  const topK = Math.min(10, Math.max(1, Number(body.top_k || 3)));
  const ranked = (rows || []).filter((m) => {
    if (required.reference_images && !m.supports_reference_images) return false;
    if (required.first_last_frame && !m.supports_first_last_frame) return false;
    if (required.native_audio && !m.supports_native_audio) return false;
    if (required.commercial_use && m.commercial_use !== true) return false;
    return true;
  }).map((m) => {
    const tier = m.quality_profile?.tier || "standard";
    let score = tierScore[tier] || 20;
    if (m.health_state === "healthy") score += 8;
    if (m.health_state === "degraded") score -= 15;
    if (required.reference_images && m.supports_reference_images) score += 6;
    if (required.first_last_frame && m.supports_first_last_frame) score += 8;
    if (required.native_audio && m.supports_native_audio) score += 6;
    if (body.preference === "quality" && tier === "premium") score += 12;
    if (body.preference === "balanced" && tier === "high") score += 8;
    return {
      model: m,
      score,
      rationale: {
        tier,
        strength: m.quality_profile?.strength || null,
        matched_requirements: Object.keys(required).filter((key) => Boolean(required[key]))
      }
    };
  }).sort((a, b) => b.score - a.score).slice(0, topK);
  return { capability: body.capability, preference: body.preference || "balanced", candidates: ranked };
}
__name(recommendModels, "recommendModels");

// src/social/router.js
init_modules_watch_stub();
function headers4(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json"
  };
}
__name(headers4, "headers");
async function db4(env, path, options = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers4(env), ...options.headers || {} }
  });
  const text2 = await res.text();
  let data = null;
  try {
    data = text2 ? JSON.parse(text2) : null;
  } catch {
    data = text2;
  }
  if (!res.ok) throw Object.assign(new Error("Social database request failed"), { status: res.status, detail: data });
  return data;
}
__name(db4, "db");
async function bodyJson(request) {
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}
__name(bodyJson, "bodyJson");
async function getOrg2(env, userId, requestedOrgId) {
  const orgId = requireOrgId(requestedOrgId);
  const rows = await db4(env, `org_members?org_id=eq.${encodeURIComponent(orgId)}&profile_id=eq.${encodeURIComponent(userId)}&select=org_id,role&limit=1`);
  if (!rows?.length) throw Object.assign(new Error("No matching McCluster organization membership found"), { status: 403 });
  return rows[0];
}
__name(getOrg2, "getOrg");
async function configuredCredentialRef(env, orgId, platform, externalAccountId) {
  if (String(platform || "").toLowerCase() !== "instagram") return null;
  const rows = await db4(env, `org_channels?org_id=eq.${encodeURIComponent(orgId)}&channel=eq.instagram&enabled=eq.true&select=token_env,secret_id,account_id&limit=1`);
  const channel = rows?.[0] || null;
  if (!channel) return null;
  if (channel.account_id && String(channel.account_id) !== String(externalAccountId)) {
    throw Object.assign(new Error("Instagram account id does not match the credential configured for this organization"), { status: 409 });
  }
  return credentialRefForConfiguredChannel("instagram", channel);
}
__name(configuredCredentialRef, "configuredCredentialRef");
async function ownedRow(env, table, id, orgId, select = "*") {
  const rows = await db4(env, `${table}?id=eq.${encodeURIComponent(id)}&org_id=eq.${encodeURIComponent(orgId)}&select=${select}&limit=1`);
  return rows?.[0] || null;
}
__name(ownedRow, "ownedRow");
async function insert(env, table, value) {
  const rows = await db4(env, table, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(value)
  });
  return rows?.[0] || null;
}
__name(insert, "insert");
async function patch(env, table, id, value) {
  const rows = await db4(env, `${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ ...value, updated_at: (/* @__PURE__ */ new Date()).toISOString() })
  });
  return rows?.[0] || null;
}
__name(patch, "patch");
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
__name(clamp, "clamp");
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
__name(num, "num");
function scoreMetrics(metrics = {}) {
  const views = num(metrics.views);
  const reach = num(metrics.reach) || views;
  const likes = num(metrics.likes);
  const comments = num(metrics.comments);
  const shares = num(metrics.shares);
  const saves = num(metrics.saves);
  const follows = num(metrics.follows);
  const dms = num(metrics.dms);
  const leads = num(metrics.leads);
  const retention = metrics.retention_3s == null ? 0 : clamp(num(metrics.retention_3s), 0, 1);
  const viewScore = clamp(Math.log10(views + 1) * 20, 0, 100);
  const engagementScore = clamp((likes + comments * 2 + shares * 4 + saves * 4) / Math.max(views, 1) * 1e3, 0, 100);
  const conversionScore = clamp((follows * 4 + dms * 8 + leads * 15) / Math.max(reach, 1) * 1e3, 0, 100);
  const retentionScore = retention * 100;
  const score = Number((viewScore * 0.2 + engagementScore * 0.35 + conversionScore * 0.25 + retentionScore * 0.2).toFixed(3));
  return { score, components: { views: Number(viewScore.toFixed(3)), engagement: Number(engagementScore.toFixed(3)), conversion: Number(conversionScore.toFixed(3)), retention: Number(retentionScore.toFixed(3)) } };
}
__name(scoreMetrics, "scoreMetrics");
function generationRequest(request, payload) {
  const h = new Headers(request.headers);
  h.set("content-type", "application/json");
  return new Request(request.url, { method: "POST", headers: h, body: JSON.stringify(payload) });
}
__name(generationRequest, "generationRequest");
async function listAccounts(request, env, user4) {
  const url = new URL(request.url);
  const org = await getOrg2(env, user4.id, url.searchParams.get("org_id"));
  const rows = await db4(env, `social_accounts?org_id=eq.${encodeURIComponent(org.org_id)}&order=created_at.asc&select=id,org_id,platform,external_account_id,handle,display_name,status,capabilities,settings,last_synced_at,created_at,updated_at`);
  return { org_id: org.org_id, accounts: rows || [] };
}
__name(listAccounts, "listAccounts");
async function createAccount(request, env, user4) {
  const body = await bodyJson(request);
  const org = await getOrg2(env, user4.id, body.org_id);
  requireOrgRole2(org, ["owner"]);
  if (!body.platform || !body.external_account_id) throw Object.assign(new Error("platform and external_account_id are required"), { status: 400 });
  if (body.credential_ref != null) {
    throw Object.assign(new Error("credential_ref is server-managed and cannot be supplied by clients"), { status: 400 });
  }
  const platform = String(body.platform).toLowerCase();
  const credentialRef = await configuredCredentialRef(env, org.org_id, platform, body.external_account_id);
  return { account: await insert(env, "social_accounts", {
    org_id: org.org_id,
    platform,
    external_account_id: String(body.external_account_id),
    handle: body.handle || null,
    display_name: body.display_name || null,
    credential_ref: credentialRef,
    status: credentialRef ? "connected" : "disconnected",
    capabilities: body.capabilities || {},
    settings: body.settings || {}
  }) };
}
__name(createAccount, "createAccount");
async function listCampaigns(request, env, user4) {
  const url = new URL(request.url);
  const org = await getOrg2(env, user4.id, url.searchParams.get("org_id"));
  const rows = await db4(env, `social_campaigns?org_id=eq.${encodeURIComponent(org.org_id)}&order=created_at.desc&select=*`);
  return { org_id: org.org_id, campaigns: rows || [] };
}
__name(listCampaigns, "listCampaigns");
async function createCampaign(request, env, user4) {
  const body = await bodyJson(request);
  const org = await getOrg2(env, user4.id, body.org_id);
  requireOrgRole2(org, ["owner"]);
  if (!body.account_id || !body.name) throw Object.assign(new Error("account_id and name are required"), { status: 400 });
  const account = await ownedRow(env, "social_accounts", body.account_id, org.org_id, "id");
  if (!account) throw Object.assign(new Error("Social account not found in this organization"), { status: 404 });
  return { campaign: await insert(env, "social_campaigns", {
    org_id: org.org_id,
    account_id: body.account_id,
    name: body.name,
    objective: body.objective || "growth",
    status: body.status || "draft",
    source_asset_id: body.source_asset_id || null,
    created_by: user4.id,
    settings: body.settings || {},
    starts_at: body.starts_at || null,
    ends_at: body.ends_at || null
  }) };
}
__name(createCampaign, "createCampaign");
async function generateVariant(request, env, user4) {
  const body = await bodyJson(request);
  if (!body.campaign_id || !body.model_id) throw Object.assign(new Error("campaign_id and model_id are required"), { status: 400 });
  const org = await getOrg2(env, user4.id, body.org_id);
  requireOrgRole2(org, ["owner"]);
  const campaign = await ownedRow(env, "social_campaigns", body.campaign_id, org.org_id);
  if (!campaign) throw Object.assign(new Error("Campaign not found in this organization"), { status: 404 });
  const leaders = await db4(env, `social_variants?campaign_id=eq.${encodeURIComponent(campaign.id)}&score=not.is.null&order=score.desc&limit=5&select=variant_key,hook,hypothesis,score,score_components`);
  const learning = (leaders || []).map((v) => `${v.variant_key}: score ${v.score}; hook=${v.hook || "n/a"}; hypothesis=${v.hypothesis || "n/a"}`).join("\n");
  const prompt = [body.prompt || "Create a distinct short-form social media variant optimized for retention and conversion.", learning ? `Prior campaign evidence:
${learning}` : "No prior campaign evidence exists yet.", body.hypothesis ? `Test hypothesis: ${body.hypothesis}` : ""].filter(Boolean).join("\n\n");
  const job = await createGeneration(generationRequest(request, {
    org_id: org.org_id,
    model_id: body.model_id,
    prompt,
    input: { ...body.input || {}, prompt: body.input?.prompt || prompt },
    budget_cents: body.budget_cents ?? null
  }), env, user4);
  const variant = await insert(env, "social_variants", {
    org_id: org.org_id,
    campaign_id: campaign.id,
    source_asset_id: body.source_asset_id || campaign.source_asset_id || null,
    media_job_id: job.id,
    variant_key: body.variant_key || `v-${Date.now().toString(36)}`,
    hypothesis: body.hypothesis || null,
    hook: body.hook || null,
    caption: body.caption || null,
    hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
    status: job.status === "completed" ? "ready" : "generating",
    metadata: { generation_model_id: body.model_id }
  });
  return { campaign_id: campaign.id, variant, media_job: job, learned_from: leaders || [] };
}
__name(generateVariant, "generateVariant");
async function leaderboard(request, env, user4, campaignId) {
  const url = new URL(request.url);
  const org = await getOrg2(env, user4.id, url.searchParams.get("org_id"));
  const campaign = await ownedRow(env, "social_campaigns", campaignId, org.org_id, "id,name,objective,status");
  if (!campaign) throw Object.assign(new Error("Campaign not found"), { status: 404 });
  const variants = await db4(env, `social_variants?campaign_id=eq.${encodeURIComponent(campaignId)}&order=score.desc.nullslast,created_at.asc&select=*`);
  return { campaign, variants: variants || [] };
}
__name(leaderboard, "leaderboard");
async function queuePublish(request, env, user4) {
  const body = await bodyJson(request);
  const org = await getOrg2(env, user4.id, body.org_id);
  requireOrgRole2(org, ["owner"]);
  if (!body.account_id) throw Object.assign(new Error("account_id is required"), { status: 400 });
  const account = await ownedRow(env, "social_accounts", body.account_id, org.org_id, "id");
  if (!account) throw Object.assign(new Error("Social account not found"), { status: 404 });
  if (body.variant_id) {
    const variant = await ownedRow(env, "social_variants", body.variant_id, org.org_id, "id,campaign_id,output_asset_id,caption");
    if (!variant) throw Object.assign(new Error("Variant not found"), { status: 404 });
    body.campaign_id ||= variant.campaign_id;
    body.video_asset_id ||= variant.output_asset_id;
    body.caption ||= variant.caption;
  }
  if (!body.video_url && !body.video_asset_id) throw Object.assign(new Error("video_url, video_asset_id, or a ready variant is required"), { status: 400 });
  const mode = body.publish_mode || "trial";
  if (!["trial", "reel"].includes(mode)) throw Object.assign(new Error("publish_mode must be trial or reel"), { status: 400 });
  return { publish_job: await insert(env, "social_publish_jobs", {
    org_id: org.org_id,
    account_id: body.account_id,
    campaign_id: body.campaign_id || null,
    variant_id: body.variant_id || null,
    publish_mode: mode,
    scheduled_at: body.scheduled_at || (/* @__PURE__ */ new Date()).toISOString(),
    state: "queued",
    dedupe_key: body.dedupe_key || `${body.account_id}:${body.variant_id || body.video_asset_id || body.video_url}:${body.scheduled_at || "now"}:${mode}`,
    payload: { video_url: body.video_url || null, video_asset_id: body.video_asset_id || null, caption: body.caption || "", share_to_feed: body.share_to_feed !== false, graduation_strategy: body.graduation_strategy || "MANUAL" }
  }) };
}
__name(queuePublish, "queuePublish");
async function registerPost(request, env, user4) {
  const body = await bodyJson(request);
  const org = await getOrg2(env, user4.id, body.org_id);
  requireOrgRole2(org, ["owner"]);
  if (!body.account_id || !body.external_media_id) throw Object.assign(new Error("account_id and external_media_id are required"), { status: 400 });
  const account = await ownedRow(env, "social_accounts", body.account_id, org.org_id, "id");
  if (!account) throw Object.assign(new Error("Social account not found"), { status: 404 });
  return { post: await insert(env, "social_posts", {
    org_id: org.org_id,
    account_id: body.account_id,
    campaign_id: body.campaign_id || null,
    variant_id: body.variant_id || null,
    publish_job_id: body.publish_job_id || null,
    external_media_id: body.external_media_id,
    permalink: body.permalink || null,
    publish_mode: body.publish_mode || "reel",
    caption: body.caption || null,
    published_at: body.published_at || (/* @__PURE__ */ new Date()).toISOString(),
    metadata: body.metadata || {}
  }) };
}
__name(registerPost, "registerPost");
async function ingestMetrics(request, env, user4) {
  const body = await bodyJson(request);
  if (!body.post_id) throw Object.assign(new Error("post_id is required"), { status: 400 });
  const org = await getOrg2(env, user4.id, body.org_id);
  requireOrgRole2(org, ["owner"]);
  const post = await ownedRow(env, "social_posts", body.post_id, org.org_id, "id,variant_id");
  if (!post) throw Object.assign(new Error("Social post not found"), { status: 404 });
  const m = body.metrics || body;
  const scored = scoreMetrics(m);
  const snapshot = await insert(env, "social_metric_snapshots", {
    org_id: org.org_id,
    post_id: post.id,
    recorded_at: body.recorded_at || (/* @__PURE__ */ new Date()).toISOString(),
    views: num(m.views),
    reach: num(m.reach),
    likes: num(m.likes),
    comments: num(m.comments),
    shares: num(m.shares),
    saves: num(m.saves),
    follows: num(m.follows),
    profile_visits: num(m.profile_visits),
    dms: num(m.dms),
    leads: num(m.leads),
    watch_time_seconds: num(m.watch_time_seconds),
    avg_watch_time_seconds: num(m.avg_watch_time_seconds),
    retention_3s: m.retention_3s == null ? null : clamp(num(m.retention_3s), 0, 1),
    score: scored.score,
    raw: body.raw || m.raw || {}
  });
  if (post.variant_id) await patch(env, "social_variants", post.variant_id, { score: scored.score, score_components: scored.components });
  return { snapshot, score: scored };
}
__name(ingestMetrics, "ingestMetrics");
async function listAutomations(request, env, user4) {
  const url = new URL(request.url);
  const org = await getOrg2(env, user4.id, url.searchParams.get("org_id"));
  const rows = await db4(env, `social_automation_rules?org_id=eq.${encodeURIComponent(org.org_id)}&order=created_at.desc&select=*`);
  return { org_id: org.org_id, automations: rows || [] };
}
__name(listAutomations, "listAutomations");
async function createAutomation(request, env, user4) {
  const body = await bodyJson(request);
  const org = await getOrg2(env, user4.id, body.org_id);
  requireOrgRole2(org, ["owner"]);
  if (!body.account_id || !body.name || !body.trigger_type || !body.action_type) throw Object.assign(new Error("account_id, name, trigger_type, and action_type are required"), { status: 400 });
  const account = await ownedRow(env, "social_accounts", body.account_id, org.org_id, "id");
  if (!account) throw Object.assign(new Error("Social account not found"), { status: 404 });
  return { automation: await insert(env, "social_automation_rules", {
    org_id: org.org_id,
    account_id: body.account_id,
    campaign_id: body.campaign_id || null,
    name: body.name,
    trigger_type: body.trigger_type,
    trigger_config: body.trigger_config || {},
    action_type: body.action_type,
    action_config: body.action_config || {},
    approval_mode: body.approval_mode || "manual",
    enabled: Boolean(body.enabled)
  }) };
}
__name(createAutomation, "createAutomation");
async function attachCompletedVariantAssets(env) {
  const variants = await db4(env, "social_variants?media_job_id=not.is.null&output_asset_id=is.null&status=in.(generating,planned)&order=created_at.asc&limit=25&select=id,org_id,media_job_id");
  let attached = 0;
  for (const variant of variants || []) {
    const jobs = await db4(env, `media_jobs?id=eq.${encodeURIComponent(variant.media_job_id)}&org_id=eq.${encodeURIComponent(variant.org_id)}&select=status&limit=1`);
    const job = jobs?.[0];
    if (!job) continue;
    if (job.status === "failed") {
      await patch(env, "social_variants", variant.id, { status: "failed" });
      continue;
    }
    if (job.status !== "completed") continue;
    const assets = await db4(env, `media_assets?job_id=eq.${encodeURIComponent(variant.media_job_id)}&order=created_at.asc&select=id&limit=1`);
    if (assets?.[0]) {
      await patch(env, "social_variants", variant.id, { output_asset_id: assets[0].id, status: "ready" });
      attached += 1;
    }
  }
  return attached;
}
__name(attachCompletedVariantAssets, "attachCompletedVariantAssets");
async function handleSocialRequest(request, env, user4) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/v1/social/accounts" && request.method === "GET") return listAccounts(request, env, user4);
  if (path === "/v1/social/accounts" && request.method === "POST") return createAccount(request, env, user4);
  if (path === "/v1/social/campaigns" && request.method === "GET") return listCampaigns(request, env, user4);
  if (path === "/v1/social/campaigns" && request.method === "POST") return createCampaign(request, env, user4);
  if (path === "/v1/social/variants/generate" && request.method === "POST") return generateVariant(request, env, user4);
  if (path === "/v1/social/publish" && request.method === "POST") return queuePublish(request, env, user4);
  if (path === "/v1/social/posts" && request.method === "POST") return registerPost(request, env, user4);
  if (path === "/v1/social/metrics" && request.method === "POST") return ingestMetrics(request, env, user4);
  if (path === "/v1/social/automations" && request.method === "GET") return listAutomations(request, env, user4);
  if (path === "/v1/social/automations" && request.method === "POST") return createAutomation(request, env, user4);
  const leaderboardMatch = path.match(/^\/v1\/social\/campaigns\/([0-9a-f-]{36})\/leaderboard$/i);
  if (leaderboardMatch && request.method === "GET") return leaderboard(request, env, user4, leaderboardMatch[1]);
  throw Object.assign(new Error("Social route not found"), { status: 404 });
}
__name(handleSocialRequest, "handleSocialRequest");

// src/social/meta.js
init_modules_watch_stub();
function headers5(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json"
  };
}
__name(headers5, "headers");
async function db5(env, path, options = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers5(env), ...options.headers || {} }
  });
  const text2 = await res.text();
  let data = null;
  try {
    data = text2 ? JSON.parse(text2) : null;
  } catch {
    data = text2;
  }
  if (!res.ok) throw Object.assign(new Error("Social database request failed"), { status: res.status, detail: data });
  return data;
}
__name(db5, "db");
async function patch2(env, table, id, values) {
  const rows = await db5(env, `${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ ...values, updated_at: (/* @__PURE__ */ new Date()).toISOString() })
  });
  return rows?.[0] || null;
}
__name(patch2, "patch");
async function insert2(env, table, values, prefer = "return=representation") {
  const rows = await db5(env, table, {
    method: "POST",
    headers: { prefer },
    body: JSON.stringify(values)
  });
  return rows?.[0] || null;
}
__name(insert2, "insert");
function graphVersion(env) {
  return env.META_GRAPH_API_VERSION || "v26.0";
}
__name(graphVersion, "graphVersion");
async function graphGet(env, path, token) {
  const res = await fetch(`https://graph.facebook.com/${graphVersion(env)}/${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const text2 = await res.text();
  let data = null;
  try {
    data = text2 ? JSON.parse(text2) : {};
  } catch {
    data = { raw: text2 };
  }
  if (!res.ok || data?.error) throw Object.assign(new Error(data?.error?.message || "Meta Graph API request failed"), { status: res.status, detail: data });
  return data;
}
__name(graphGet, "graphGet");
async function graphPost(env, path, token, params) {
  const body = new URLSearchParams(params);
  const res = await fetch(`https://graph.facebook.com/${graphVersion(env)}/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  const text2 = await res.text();
  let data = null;
  try {
    data = text2 ? JSON.parse(text2) : {};
  } catch {
    data = { raw: text2 };
  }
  if (!res.ok || data?.error) throw Object.assign(new Error(data?.error?.message || "Meta Graph API request failed"), { status: res.status, detail: data });
  return data;
}
__name(graphPost, "graphPost");
async function tokenFor(env, account) {
  if (!account?.org_id || String(account.platform || "").toLowerCase() !== "instagram") return null;
  const rows = await db5(env, `org_channels?org_id=eq.${encodeURIComponent(account.org_id)}&channel=eq.instagram&enabled=eq.true&select=token_env,secret_id,account_id&limit=1`);
  const channel = rows?.[0] || null;
  if (!channel) return null;
  if (channel.account_id && String(channel.account_id) !== String(account.external_account_id)) return null;
  const ref = credentialRefForConfiguredChannel("instagram", channel);
  const parsed = parseSocialCredentialRef("instagram", ref);
  if (!parsed) return null;
  if (parsed.kind === "env") return env[parsed.name] || null;
  if (parsed.kind === "vault") {
    const token = await db5(env, "rpc/vault_secret", {
      method: "POST",
      body: JSON.stringify({ p_id: parsed.id })
    });
    return typeof token === "string" && token ? token : null;
  }
  return null;
}
__name(tokenFor, "tokenFor");
async function resolveVideoUrl(env, job) {
  if (job.payload?.video_url) return job.payload.video_url;
  if (!job.payload?.video_asset_id) return null;
  const rows = await db5(env, `media_assets?id=eq.${encodeURIComponent(job.payload.video_asset_id)}&org_id=eq.${encodeURIComponent(job.org_id)}&select=url&limit=1`);
  return rows?.[0]?.url || null;
}
__name(resolveVideoUrl, "resolveVideoUrl");
async function accountForJob(env, job) {
  const rows = await db5(env, `social_accounts?id=eq.${encodeURIComponent(job.account_id)}&org_id=eq.${encodeURIComponent(job.org_id)}&platform=eq.instagram&select=*&limit=1`);
  return rows?.[0] || null;
}
__name(accountForJob, "accountForJob");
async function beginInstagramPublish(env, job, account, token) {
  const videoUrl = await resolveVideoUrl(env, job);
  if (!videoUrl) throw new Error("Publish job has no resolvable video URL");
  const params = {
    media_type: "REELS",
    video_url: videoUrl,
    caption: job.payload?.caption || ""
  };
  if (job.payload?.share_to_feed !== false) params.share_to_feed = "true";
  if (job.publish_mode === "trial") {
    const graduation = ["MANUAL", "SS_PERFORMANCE"].includes(job.payload?.graduation_strategy) ? job.payload.graduation_strategy : "MANUAL";
    params.trial_params = JSON.stringify({ graduation_strategy: graduation });
  }
  const created = await graphPost(env, `${encodeURIComponent(account.external_account_id)}/media`, token, params);
  if (!created?.id) throw new Error("Meta did not return a creation container id");
  await patch2(env, "social_publish_jobs", job.id, {
    state: "processing",
    external_creation_id: created.id,
    attempts: Number(job.attempts || 0) + 1,
    last_error: null,
    lease_owner: null,
    lease_expires_at: null
  });
  return { state: "processing", creation_id: created.id };
}
__name(beginInstagramPublish, "beginInstagramPublish");
async function finishInstagramPublish(env, job, account, token) {
  if (!job.external_creation_id) throw new Error("Processing publish job is missing its creation container id");
  const status = await graphGet(env, `${encodeURIComponent(job.external_creation_id)}?fields=status_code`, token);
  const code = status?.status_code || "UNKNOWN";
  if (code === "IN_PROGRESS") {
    await patch2(env, "social_publish_jobs", job.id, { lease_owner: null, lease_expires_at: null });
    return { state: "processing", status_code: code };
  }
  if (["ERROR", "EXPIRED"].includes(code)) throw new Error(`Instagram creation container ${code.toLowerCase()}`);
  if (code !== "FINISHED") {
    await patch2(env, "social_publish_jobs", job.id, { lease_owner: null, lease_expires_at: null });
    return { state: "processing", status_code: code };
  }
  const published = await graphPost(env, `${encodeURIComponent(account.external_account_id)}/media_publish`, token, {
    creation_id: job.external_creation_id
  });
  if (!published?.id) throw new Error("Meta did not return a published media id");
  await patch2(env, "social_publish_jobs", job.id, {
    state: "published",
    external_media_id: published.id,
    attempts: Number(job.attempts || 0) + 1,
    last_error: null,
    lease_owner: null,
    lease_expires_at: null
  });
  const existing = await db5(env, `social_posts?account_id=eq.${encodeURIComponent(account.id)}&external_media_id=eq.${encodeURIComponent(published.id)}&select=*&limit=1`);
  const post = existing?.[0] || await insert2(env, "social_posts", {
    org_id: job.org_id,
    account_id: job.account_id,
    campaign_id: job.campaign_id || null,
    variant_id: job.variant_id || null,
    publish_job_id: job.id,
    external_media_id: published.id,
    publish_mode: job.publish_mode,
    caption: job.payload?.caption || "",
    published_at: (/* @__PURE__ */ new Date()).toISOString(),
    metadata: { meta_creation_id: job.external_creation_id }
  });
  return { state: "published", media_id: published.id, post_id: post?.id || null };
}
__name(finishInstagramPublish, "finishInstagramPublish");
async function processPublishJob(env, job) {
  const account = await accountForJob(env, job);
  if (!account) throw new Error("Instagram account is missing or does not belong to this organization");
  const token = await tokenFor(env, account);
  if (!token) {
    await patch2(env, "social_publish_jobs", job.id, {
      lease_owner: null,
      lease_expires_at: null,
      last_error: "credential_secret_not_configured"
    });
    return { state: job.state, deferred: true, reason: "credential_secret_not_configured" };
  }
  if (job.state === "queued") return beginInstagramPublish(env, job, account, token);
  if (job.state === "processing") return finishInstagramPublish(env, job, account, token);
  await patch2(env, "social_publish_jobs", job.id, { lease_owner: null, lease_expires_at: null });
  return { state: job.state, skipped: true };
}
__name(processPublishJob, "processPublishJob");
async function claimPublishJobs(env, limit) {
  const leaseOwner = crypto.randomUUID();
  const jobs = await db5(env, "rpc/claim_social_publish_jobs", {
    method: "POST",
    body: JSON.stringify({
      p_lease_owner: leaseOwner,
      p_limit: limit,
      p_lease_seconds: 120
    })
  });
  return Array.isArray(jobs) ? jobs : [];
}
__name(claimPublishJobs, "claimPublishJobs");
async function processInstagramPublishQueue(env, { limit = 10 } = {}) {
  const safeLimit = Math.min(25, Math.max(1, Number(limit) || 10));
  const jobs = await claimPublishJobs(env, safeLimit);
  const results = [];
  for (const job of jobs) {
    try {
      results.push({ id: job.id, ...await processPublishJob(env, job) });
    } catch (error) {
      const attempts = Number(job.attempts || 0) + 1;
      const terminal = attempts >= 5;
      await patch2(env, "social_publish_jobs", job.id, {
        state: terminal ? "failed" : job.state,
        attempts,
        last_error: error instanceof Error ? error.message : String(error),
        lease_owner: null,
        lease_expires_at: null
      });
      results.push({ id: job.id, state: terminal ? "failed" : job.state, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked: jobs.length, results };
}
__name(processInstagramPublishQueue, "processInstagramPublishQueue");
function metricValue(payload) {
  const value = payload?.data?.[0]?.values?.[0]?.value;
  return typeof value === "number" ? value : Number(value || 0);
}
__name(metricValue, "metricValue");
async function safeInsight(env, mediaId, metric, token) {
  try {
    const payload = await graphGet(env, `${encodeURIComponent(mediaId)}/insights?metric=${encodeURIComponent(metric)}`, token);
    return metricValue(payload);
  } catch {
    return null;
  }
}
__name(safeInsight, "safeInsight");
function nextInsightsAt(publishedAt, now = /* @__PURE__ */ new Date()) {
  const published = new Date(publishedAt || now);
  const ageMs = Math.max(0, now.getTime() - published.getTime());
  let delayMs = 15 * 60 * 1e3;
  if (ageMs >= 24 * 60 * 60 * 1e3 && ageMs < 72 * 60 * 60 * 1e3) delayMs = 60 * 60 * 1e3;
  if (ageMs >= 72 * 60 * 60 * 1e3) delayMs = 6 * 60 * 60 * 1e3;
  return new Date(now.getTime() + delayMs).toISOString();
}
__name(nextInsightsAt, "nextInsightsAt");
async function syncPostInsights(env, post) {
  const accounts = await db5(env, `social_accounts?id=eq.${encodeURIComponent(post.account_id)}&org_id=eq.${encodeURIComponent(post.org_id)}&platform=eq.instagram&select=*&limit=1`);
  const account = accounts?.[0];
  const token = await tokenFor(env, account);
  if (!account || !token) {
    await patch2(env, "social_posts", post.id, {
      next_insights_sync_at: new Date(Date.now() + 60 * 60 * 1e3).toISOString()
    });
    return { post_id: post.id, deferred: true, reason: "credential_secret_not_configured" };
  }
  let fields = {};
  try {
    fields = await graphGet(env, `${encodeURIComponent(post.external_media_id)}?fields=like_count,comments_count,permalink,timestamp`, token);
  } catch {
    fields = {};
  }
  const [views, reach, saved, shares] = await Promise.all([
    safeInsight(env, post.external_media_id, "views", token),
    safeInsight(env, post.external_media_id, "reach", token),
    safeInsight(env, post.external_media_id, "saved", token),
    safeInsight(env, post.external_media_id, "shares", token)
  ]);
  const metrics = {
    views: views ?? 0,
    reach: reach ?? 0,
    likes: Number(fields.like_count || 0),
    comments: Number(fields.comments_count || 0),
    shares: shares ?? 0,
    saves: saved ?? 0,
    follows: 0,
    profile_visits: 0,
    dms: 0,
    leads: 0,
    watch_time_seconds: 0,
    avg_watch_time_seconds: 0,
    retention_3s: null
  };
  const scored = scoreMetrics(metrics);
  const snapshot = await insert2(env, "social_metric_snapshots", {
    org_id: post.org_id,
    post_id: post.id,
    ...metrics,
    score: scored.score,
    raw: { graph_fields: fields, synced_metrics: ["views", "reach", "saved", "shares"] }
  });
  if (post.variant_id) await patch2(env, "social_variants", post.variant_id, { score: scored.score, score_components: scored.components });
  const syncedAt = /* @__PURE__ */ new Date();
  await patch2(env, "social_posts", post.id, {
    ...fields.permalink ? { permalink: fields.permalink } : {},
    last_insights_synced_at: syncedAt.toISOString(),
    next_insights_sync_at: nextInsightsAt(post.published_at, syncedAt)
  });
  return { post_id: post.id, snapshot_id: snapshot?.id || null, score: scored.score };
}
__name(syncPostInsights, "syncPostInsights");
async function claimInsightPosts(env, limit) {
  const posts = await db5(env, "rpc/claim_social_insight_posts", {
    method: "POST",
    body: JSON.stringify({ p_limit: limit })
  });
  return Array.isArray(posts) ? posts : [];
}
__name(claimInsightPosts, "claimInsightPosts");
async function syncInstagramInsights(env, { limit = 25 } = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const posts = await claimInsightPosts(env, safeLimit);
  const results = [];
  for (const post of posts) {
    try {
      results.push(await syncPostInsights(env, post));
    } catch (error) {
      try {
        await patch2(env, "social_posts", post.id, {
          next_insights_sync_at: new Date(Date.now() + 15 * 60 * 1e3).toISOString()
        });
      } catch {
      }
      results.push({ post_id: post.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked: posts.length, results };
}
__name(syncInstagramInsights, "syncInstagramInsights");

// src/social/webhook.js
init_modules_watch_stub();
function headers6(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json"
  };
}
__name(headers6, "headers");
async function db6(env, path, options = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers6(env), ...options.headers || {} }
  });
  const text2 = await res.text();
  let data = null;
  try {
    data = text2 ? JSON.parse(text2) : null;
  } catch {
    data = text2;
  }
  if (!res.ok) throw Object.assign(new Error("Social webhook database request failed"), { status: res.status, detail: data });
  return data;
}
__name(db6, "db");
function secureEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
__name(secureEqual, "secureEqual");
async function hmacHex(secret, text2) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text2));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hmacHex, "hmacHex");
async function sha256(text2) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text2));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256, "sha256");
async function accountForEntry(env, entry) {
  const externalId = String(entry.id || entry.recipient?.id || "");
  if (!externalId) return null;
  const rows = await db6(env, `social_accounts?platform=eq.instagram&external_account_id=eq.${encodeURIComponent(externalId)}&select=id,org_id&limit=1`);
  return rows?.[0] || null;
}
__name(accountForEntry, "accountForEntry");
async function storeEvent(env, event) {
  await db6(env, "social_webhook_events?on_conflict=platform,event_id", {
    method: "POST",
    headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(event)
  });
}
__name(storeEvent, "storeEvent");
async function handleMetaWebhook(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token") || "";
    const challenge = url.searchParams.get("hub.challenge") || "";
    if (mode === "subscribe" && env.META_WEBHOOK_VERIFY_TOKEN && secureEqual(token, env.META_WEBHOOK_VERIFY_TOKEN)) {
      return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
    }
    return new Response("Webhook verification failed", { status: 403 });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!env.META_APP_SECRET) return new Response("META_APP_SECRET is not configured", { status: 503 });
  const raw = await request.text();
  const supplied = request.headers.get("x-hub-signature-256") || "";
  const expected = `sha256=${await hmacHex(env.META_APP_SECRET, raw)}`;
  if (!secureEqual(supplied, expected)) return new Response("Invalid webhook signature", { status: 401 });
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const digest = await sha256(raw);
  let accepted = 0;
  for (const entry of payload.entry || []) {
    const account = await accountForEntry(env, entry);
    const items = [
      ...(entry.messaging || []).map((value) => ({ type: "message", value })),
      ...(entry.changes || []).map((value) => ({ type: value.field || "change", value }))
    ];
    for (const item of items) {
      await storeEvent(env, {
        org_id: account?.org_id || null,
        account_id: account?.id || null,
        platform: "instagram",
        event_id: `${digest}:${accepted}`,
        event_type: item.type,
        payload: item.value
      });
      accepted += 1;
    }
  }
  return new Response(JSON.stringify({ ok: true, accepted }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
__name(handleMetaWebhook, "handleMetaWebhook");

// src/ai/router.js
init_modules_watch_stub();
var MAX_BODY = 512 * 1024;
function sbHeaders10(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json"
  };
}
__name(sbHeaders10, "sbHeaders");
async function rpc3(env, name, body) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: sbHeaders10(env),
    body: JSON.stringify(body)
  });
  const text2 = await res.text();
  let data = null;
  try {
    data = text2 ? JSON.parse(text2) : null;
  } catch {
    data = text2;
  }
  if (!res.ok) {
    const message = data && (data.message || data.hint || data.error) || "McCluster AI request failed";
    throw Object.assign(new Error(message), { status: res.status >= 400 && res.status < 500 ? 400 : 502, detail: data });
  }
  return data;
}
__name(rpc3, "rpc");
async function houseOrgId(env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/orgs?slug=eq.mccluster&select=id&limit=1`, { headers: sbHeaders10(env) });
  const rows = await res.json().catch(() => []);
  return rows?.[0]?.id || null;
}
__name(houseOrgId, "houseOrgId");
async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY) throw Object.assign(new Error("payload too large"), { status: 413 });
  const text2 = await request.text();
  if (text2.length > MAX_BODY) throw Object.assign(new Error("payload too large"), { status: 413 });
  try {
    return text2 ? JSON.parse(text2) : {};
  } catch {
    throw Object.assign(new Error("invalid json"), { status: 400 });
  }
}
__name(readJson, "readJson");
async function handleAiRequest(request, env, user4) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/v1/ai" && !path.startsWith("/v1/ai/")) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return fail(request, env, "McCluster is not configured", 503);
  }
  if (!user4) return fail(request, env, "Authentication required", 401);
  const orgId = url.searchParams.get("org_id") || await houseOrgId(env);
  if (!orgId) return fail(request, env, "McCluster house organization is not configured", 503);
  const membershipsRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/org_members?org_id=eq.${encodeURIComponent(orgId)}&profile_id=eq.${encodeURIComponent(user4.id)}&role=eq.owner&select=org_id,role&limit=1`,
    { headers: sbHeaders10(env) }
  );
  const memberships = await membershipsRes.json().catch(() => []);
  if (!memberships?.length) return fail(request, env, "McCluster house owner access required", 403);
  if (path === "/v1/ai" && request.method === "GET") {
    return reply(request, env, {
      ok: true,
      harness: "ai_context",
      ingest: "/v1/ai/ingest",
      retrieve: "/v1/ai/retrieve",
      decisions: "/v1/ai/decisions",
      status: "/v1/ai/status"
    });
  }
  if (path === "/v1/ai/status" && request.method === "GET") {
    const data = await rpc3(env, "ai_harness_status", { p_org: orgId });
    return reply(request, env, data);
  }
  if (path === "/v1/ai/ingest" && request.method === "POST") {
    const body = await readJson(request);
    if (!body.org_id) body.org_id = orgId;
    const envelope = validateEnvelope(body);
    const data = await rpc3(env, "ai_ingest", { envelope });
    return reply(request, env, data, data?.duplicate ? 200 : 202);
  }
  if (path === "/v1/ai/retrieve" && request.method === "POST") {
    const body = await readJson(request);
    const query = String(body.query || body.q || "").slice(0, 500);
    const limit = Math.max(1, Math.min(Number(body.limit) || 8, 32));
    const data = await rpc3(env, "ai_retrieve", {
      p_org: body.org_id || orgId,
      p_query: query,
      p_limit: limit
    });
    return reply(request, env, data);
  }
  if (path === "/v1/ai/decisions" && request.method === "POST") {
    const body = await readJson(request);
    if (!body.org_id) body.org_id = orgId;
    if (!String(body.title || "").trim()) return fail(request, env, "title required", 400);
    const data = await rpc3(env, "ai_record_decision", { envelope: body });
    return reply(request, env, data, 202);
  }
  return fail(request, env, "Not found", 404);
}
__name(handleAiRequest, "handleAiRequest");

// src/entry.js
async function authUser4(req, env) {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization }
  });
  if (!res.ok) return null;
  return res.json();
}
__name(authUser4, "authUser");
var entry_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      const clientResponse = await handleClientRequest(request, env);
      if (clientResponse) return clientResponse;
    } catch (error) {
      return fail(request, env, error.message || "Client request failed", error.status || 500, error.detail);
    }
    try {
      const connectResponse = await connect_default.fetch(request, env, url, reply, fail, logEvent);
      if (connectResponse) return connectResponse;
    } catch (error) {
      return fail(request, env, error.message || "Client Connect request failed", error.status || 500, error.detail);
    }
    if (path === "/v1/media/webhooks/fal" && request.method === "POST") {
      try {
        const result2 = await handleFalWebhook(request, env);
        return reply(request, env, result2);
      } catch (error) {
        return fail(request, env, error.message || "fal webhook failed", error.status || 500, error.detail);
      }
    }
    if (path === "/v1/social/webhooks/meta" && ["GET", "POST"].includes(request.method)) {
      try {
        return await handleMetaWebhook(request, env);
      } catch (error) {
        return fail(request, env, error.message || "Meta webhook failed", error.status || 500, error.detail);
      }
    }
    if (path === "/v1/media/models" && request.method === "GET") {
      try {
        const user4 = await authUser4(request, env);
        if (!user4) return fail(request, env, "Authentication required", 401);
        const models = await listModels(request, env);
        return reply(request, env, { models });
      } catch (error) {
        return fail(request, env, error.message || "Media model request failed", error.status || 500, error.detail);
      }
    }
    if (path === "/v1/media/recommend" && request.method === "POST") {
      try {
        const user4 = await authUser4(request, env);
        if (!user4) return fail(request, env, "Authentication required", 401);
        const recommendation = await recommendModels(request, env);
        return reply(request, env, recommendation);
      } catch (error) {
        return fail(request, env, error.message || "Media recommendation failed", error.status || 500, error.detail);
      }
    }
    if (path === "/v1/media/generate" && request.method === "POST") {
      try {
        const user4 = await authUser4(request, env);
        if (!user4) return fail(request, env, "Authentication required", 401);
        const job = await createGeneration(request, env, user4);
        return reply(request, env, { job }, 202);
      } catch (error) {
        return fail(request, env, error.message || "Media generation request failed", error.status || 500, error.detail);
      }
    }
    if (path === "/v1/media/bakeoff" && request.method === "POST") {
      try {
        const user4 = await authUser4(request, env);
        if (!user4) return fail(request, env, "Authentication required", 401);
        const bakeoff = await createBakeoff(request, env, user4);
        return reply(request, env, bakeoff, 202);
      } catch (error) {
        return fail(request, env, error.message || "Media bakeoff request failed", error.status || 500, error.detail);
      }
    }
    const jobMatch = path.match(/^\/v1\/media\/jobs\/([0-9a-f-]{36})$/i);
    if (jobMatch && request.method === "GET") {
      try {
        const user4 = await authUser4(request, env);
        if (!user4) return fail(request, env, "Authentication required", 401);
        const data = await getGeneration(request, env, user4, jobMatch[1], true);
        return reply(request, env, data);
      } catch (error) {
        return fail(request, env, error.message || "Media job request failed", error.status || 500, error.detail);
      }
    }
    if (path === "/v1/social" || path.startsWith("/v1/social/")) {
      try {
        const user4 = await authUser4(request, env);
        if (!user4) return fail(request, env, "Authentication required", 401);
        const data = await handleSocialRequest(request, env, user4);
        const accepted = request.method === "POST" && ["/v1/social/variants/generate", "/v1/social/publish"].includes(path);
        return reply(request, env, data, accepted ? 202 : 200);
      } catch (error) {
        return fail(request, env, error.message || "Social request failed", error.status || 500, error.detail);
      }
    }
    if (path === "/v1/ai" || path.startsWith("/v1/ai/")) {
      try {
        const user4 = await authUser4(request, env);
        const response = await handleAiRequest(request, env, user4);
        if (response) return response;
      } catch (error) {
        return fail(request, env, error.message || "AI harness request failed", error.status || 500, error.detail);
      }
    }
    return src_default.fetch(request, env, ctx);
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(Promise.all([
      reconcilePendingFalCosts(env, { limit: 50 }).catch((error) => {
        console.error(JSON.stringify({
          event: "media_cost_reconciliation_failed",
          message: error instanceof Error ? error.message : String(error)
        }));
      }),
      attachCompletedVariantAssets(env).catch((error) => {
        console.error(JSON.stringify({
          event: "social_variant_attachment_failed",
          message: error instanceof Error ? error.message : String(error)
        }));
      }),
      processInstagramPublishQueue(env, { limit: 10 }).catch((error) => {
        console.error(JSON.stringify({
          event: "social_instagram_publish_cycle_failed",
          message: error instanceof Error ? error.message : String(error)
        }));
      }),
      syncInstagramInsights(env, { limit: 25 }).catch((error) => {
        console.error(JSON.stringify({
          event: "social_instagram_insights_sync_failed",
          message: error instanceof Error ? error.message : String(error)
        }));
      })
    ]));
  }
};

// ../../../../../root/.npm/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
init_modules_watch_stub();
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../root/.npm/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
init_modules_watch_stub();
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers7 = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers7["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers: headers7 });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-3BnKMC/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = entry_default;

// ../../../../../root/.npm/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/common.ts
init_modules_watch_stub();
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-3BnKMC/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  HereTenantAgent,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=entry.js.map
