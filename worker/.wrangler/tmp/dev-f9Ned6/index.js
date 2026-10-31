var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// node_modules/hono/dist/utils/buffer.js
var bufferToFormData = /* @__PURE__ */ __name((arrayBuffer, contentType) => {
  return new Response(arrayBuffer, { headers: { "Content-Type": contentType.replace(/^[^;]+/, (mediaType) => mediaType.toLowerCase()) } }).formData();
}, "bufferToFormData");

// node_modules/hono/dist/utils/body.js
var MAX_NESTED_OBJECTS = 1e4;
var isRawRequest = /* @__PURE__ */ __name((request) => "headers" in request, "isRawRequest");
var parseBody = /* @__PURE__ */ __name(async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const mediaType = (isRawRequest(request) ? request.headers : request.raw.headers).get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (mediaType === "multipart/form-data" || mediaType === "application/x-www-form-urlencoded") return parseFormData(request, {
    all,
    dot
  });
  return {};
}, "parseBody");
async function parseFormData(request, options) {
  if (!isRawRequest(request) && request.bodyCache.formData) return convertFormDataToBodyData(await request.bodyCache.formData, options);
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const arrayBuffer = await request.arrayBuffer();
  const formDataPromise = bufferToFormData(arrayBuffer, headers.get("Content-Type") || "");
  if (!isRawRequest(request)) request.bodyCache.formData = formDataPromise;
  const formData = await formDataPromise;
  if (formData) return convertFormDataToBodyData(formData, options);
  return {};
}
__name(parseFormData, "parseFormData");
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  const nestingState = { count: 0 };
  formData.forEach((value, key) => {
    if (!(options.all || key.endsWith("[]"))) form[key] = value;
    else handleParsingAllValues(form, key, value);
  });
  if (options.dot) Object.entries(form).forEach(([key, value]) => {
    if (key.includes(".")) {
      handleParsingNestedValues(form, key, value, nestingState);
      delete form[key];
    }
  });
  return form;
}
__name(convertFormDataToBodyData, "convertFormDataToBodyData");
var handleParsingAllValues = /* @__PURE__ */ __name((form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) form[key].push(value);
    else form[key] = [form[key], value];
  } else if (!key.endsWith("[]")) form[key] = value;
  else form[key] = [value];
}, "handleParsingAllValues");
var handleParsingNestedValues = /* @__PURE__ */ __name((form, key, value, state) => {
  if (/(?:^|\.)__proto__\./.test(key)) return;
  let nestedForm = form;
  const keys = key.split(".", 34);
  if (keys.length > 33) throwNestingLimitExceeded();
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) nestedForm[key2] = value;
    else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        if (state.count++ >= MAX_NESTED_OBJECTS) throwNestingLimitExceeded();
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
}, "handleParsingNestedValues");
var throwNestingLimitExceeded = /* @__PURE__ */ __name(() => {
  throw new Error("Nesting limit exceeded");
}, "throwNestingLimitExceeded");

// node_modules/hono/dist/utils/url.js
var splitPath = /* @__PURE__ */ __name((path) => {
  const paths = path.split("/");
  if (paths[0] === "") paths.shift();
  return paths;
}, "splitPath");
var splitRoutingPath = /* @__PURE__ */ __name((routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
}, "splitRoutingPath");
var extractGroupsFromPath = /* @__PURE__ */ __name((path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return {
    groups,
    path
  };
}, "extractGroupsFromPath");
var replaceGroupMarks = /* @__PURE__ */ __name((paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) if (paths[j].includes(mark)) {
      paths[j] = paths[j].replace(mark, groups[i][1]);
      break;
    }
  }
  return paths;
}, "replaceGroupMarks");
var patternCache = {};
var getPattern = /* @__PURE__ */ __name((label, next) => {
  if (label === "*") return "*";
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [
        cacheKey,
        match2[1],
        new RegExp(`^${match2[2]}(?=/${next})`)
      ] : [
        label,
        match2[1],
        new RegExp(`^${match2[2]}$`)
      ];
      else patternCache[cacheKey] = [
        label,
        match2[1],
        true
      ];
    }
    return patternCache[cacheKey];
  }
  return null;
}, "getPattern");
var tryDecode = /* @__PURE__ */ __name((str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
}, "tryDecode");
var tryDecodeURI = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURI), "tryDecodeURI");
var getPath = /* @__PURE__ */ __name((request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) break;
  }
  return url.slice(start, i);
}, "getPath");
var getPathNoStrict = /* @__PURE__ */ __name((request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
}, "getPathNoStrict");
var mergePath = /* @__PURE__ */ __name((base, sub, ...rest) => {
  if (rest.length) sub = mergePath(sub, ...rest);
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
}, "mergePath");
var checkOptionalParameter = /* @__PURE__ */ __name((path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) return null;
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) basePath += "/" + segment;
    else if (/\:/.test(segment)) {
      if (segment.charCodeAt(segment.length - 1) === 63) {
        if (results.length === 0 && basePath === "") results.push("/");
        else results.push(basePath);
        const optionalSegment = segment.slice(0, -1);
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else basePath += "/" + segment;
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
}, "checkOptionalParameter");
var tryDecodeURIComponent = /* @__PURE__ */ __name((str) => str.indexOf("%") !== -1 ? tryDecode(str, decodeURIComponent_) : str, "tryDecodeURIComponent");
var _decodeURI = /* @__PURE__ */ __name((value) => {
  if (value.indexOf("+") !== -1) value = value.replace(/\+/g, " ");
  return tryDecodeURIComponent(value);
}, "_decodeURI");
var _getQueryParam = /* @__PURE__ */ __name((url, key, multiple) => {
  const hashIndex = url.indexOf("#", 8);
  if (hashIndex !== -1) url = url.slice(0, hashIndex);
  let encoded;
  if (!multiple && key && key.indexOf("%") === -1 && key.indexOf("+") === -1) {
    const queryIndex = url.indexOf("?", 8);
    let keyIndex2 = queryIndex;
    if (keyIndex2 === -1) return;
    if (!url.startsWith(key, keyIndex2 + 1)) keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61 || trailingKeyCode === 38 || isNaN(trailingKeyCode)) {
        if (keyIndex2 > queryIndex && /(?:^|&)[^=&]*[%+]/.test(url.slice(queryIndex + 1, keyIndex2))) break;
        if (trailingKeyCode === 61) {
          const valueIndex = keyIndex2 + key.length + 2;
          const endIndex = url.indexOf("&", valueIndex);
          return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
        }
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) return;
  }
  const results = /* @__PURE__ */ Object.create(null);
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) valueIndex = -1;
    let name = url.slice(keyIndex + 1, valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex);
    if (encoded) name = _decodeURI(name);
    keyIndex = nextKeyIndex;
    if (name === "") continue;
    let value;
    if (valueIndex === -1) value = "";
    else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) value = _decodeURI(value);
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) results[name] = [];
      results[name].push(value);
    } else results[name] ??= value;
  }
  return key ? results[key] : results;
}, "_getQueryParam");
var getQueryParam = _getQueryParam;
var getQueryParams = /* @__PURE__ */ __name((url, key) => {
  return _getQueryParam(url, key, true);
}, "getQueryParams");
var decodeURIComponent_ = decodeURIComponent;

// node_modules/hono/dist/request.js
var HonoRequest = class {
  static {
    __name(this, "HonoRequest");
  }
  /**
  * `.raw` can get the raw Request object.
  *
  * @see {@link https://hono.dev/docs/api/request#raw}
  *
  * @example
  * ```ts
  * // For Cloudflare Workers
  * app.post('/', async (c) => {
  *   const metadata = c.req.raw.cf?.hostMetadata?
  *   ...
  * })
  * ```
  */
  raw;
  #validatedData;
  #matchResult;
  routeIndex = 0;
  /**
  * `.path` can get the pathname of the request.
  *
  * @see {@link https://hono.dev/docs/api/request#path}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const pathname = c.req.path // `/about/me`
  * })
  * ```
  */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex]?.[1][key];
    const param = this.#getParamValue(paramKey);
    return param && tryDecodeURIComponent(param);
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex]?.[1] ?? {});
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) decoded[key] = tryDecodeURIComponent(value);
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) return this.raw.headers.get(name) ?? void 0;
    const headerData = /* @__PURE__ */ Object.create(null);
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = /* @__PURE__ */ __name((key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) return cachedBody;
    for (const anyCachedKey in bodyCache) return bodyCache[anyCachedKey].then((body) => {
      if (anyCachedKey === "json") body = JSON.stringify(body);
      const contentType = anyCachedKey === "formData" ? void 0 : raw2.headers.get("content-type");
      return new Response(body, { headers: contentType ? { "Content-Type": contentType } : void 0 })[key]();
    });
    return bodyCache[key] = raw2[key]();
  }, "#cachedBody");
  /**
  * `.json()` can parse Request body of type `application/json`
  *
  * @see {@link https://hono.dev/docs/api/request#json}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.json()
  * })
  * ```
  */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
  * `.text()` can parse Request body of type `text/plain`
  *
  * @see {@link https://hono.dev/docs/api/request#text}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.text()
  * })
  * ```
  */
  text() {
    return this.#cachedBody("text");
  }
  /**
  * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
  *
  * @see {@link https://hono.dev/docs/api/request#arraybuffer}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.arrayBuffer()
  * })
  * ```
  */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
  * `.bytes()` parses the request body as a `Uint8Array`.
  *
  * @see {@link https://hono.dev/docs/api/request#bytes}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.bytes()
  * })
  * ```
  */
  bytes() {
    return this.#cachedBody("arrayBuffer").then((buffer) => new Uint8Array(buffer));
  }
  /**
  * Parses the request body as a `Blob`.
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.blob();
  * });
  * ```
  * @see https://hono.dev/docs/api/request#blob
  */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
  * Parses the request body as `FormData`.
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.formData();
  * });
  * ```
  * @see https://hono.dev/docs/api/request#formdata
  */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
  * Adds validated data to the request.
  *
  * @param target - The target of the validation.
  * @param data - The validated data to add.
  */
  addValidatedData(target, data) {
    (this.#validatedData ??= {})[target] = data;
  }
  valid(target) {
    return this.#validatedData?.[target];
  }
  /**
  * `.url` can get the request url strings.
  *
  * @see {@link https://hono.dev/docs/api/request#url}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const url = c.req.url // `http://localhost:8787/about/me`
  *   ...
  * })
  * ```
  */
  get url() {
    return this.raw.url;
  }
  /**
  * `.method` can get the method name of the request.
  *
  * @see {@link https://hono.dev/docs/api/request#method}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const method = c.req.method // `GET`
  * })
  * ```
  */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
  * `.matchedRoutes` can return a matched route in the handler
  *
  * @deprecated
  *
  * Use matchedRoutes helper defined in "hono/route" instead.
  *
  * @see {@link https://hono.dev/docs/api/request#matchedroutes}
  *
  * @example
  * ```ts
  * app.use('*', async function logger(c, next) {
  *   await next()
  *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
  *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
  *     console.log(
  *       method,
  *       ' ',
  *       path,
  *       ' '.repeat(Math.max(10 - path.length, 0)),
  *       name,
  *       i === c.req.routeIndex ? '<- respond from here' : ''
  *     )
  *   })
  * })
  * ```
  */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
  * `.routePath` can retrieve the path registered within the handler
  *
  * @deprecated
  *
  * Use routePath helper defined in "hono/route" instead.
  *
  * @see {@link https://hono.dev/docs/api/request#routepath}
  *
  * @example
  * ```ts
  * app.get('/posts/:id', (c) => {
  *   return c.json({ path: c.req.routePath })
  * })
  * ```
  */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = /* @__PURE__ */ __name((value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
}, "raw");
var resolveCallback = /* @__PURE__ */ __name(async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) str = str.toString();
    if (str instanceof Promise) str = await str;
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) return Promise.resolve(str);
  if (buffer) buffer[0] += str;
  else buffer = [str];
  const resStr = Promise.all(callbacks.map((c) => c({
    phase,
    buffer,
    context
  }))).then((res) => Promise.all(res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))).then(() => buffer[0]));
  if (preserveCallbacks) return raw(await resStr, callbacks);
  else return resStr;
}, "resolveCallback");

// node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = /* @__PURE__ */ __name((contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
}, "setDefaultContentType");
var createResponseInstance = /* @__PURE__ */ __name((body, init) => new Response(body, init), "createResponseInstance");
var Context = class {
  static {
    __name(this, "Context");
  }
  #rawRequest;
  #req;
  /**
  * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
  *
  * @see {@link https://hono.dev/docs/api/context#env}
  *
  * @example
  * ```ts
  * // Environment object for Cloudflare Workers
  * app.get('*', async c => {
  *   const counter = c.env.COUNTER
  * })
  * ```
  */
  env = {};
  #var;
  finalized = false;
  /**
  * `.error` can get the error object from the middleware if the Handler throws an error.
  *
  * @see {@link https://hono.dev/docs/api/context#error}
  *
  * @example
  * ```ts
  * app.use('*', async (c, next) => {
  *   await next()
  *   if (c.error) {
  *     // do something...
  *   }
  * })
  * ```
  */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
  * Creates an instance of the Context class.
  *
  * @param req - The Request object.
  * @param options - Optional configuration options for the context.
  */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
  * `.req` is the instance of {@link HonoRequest}.
  */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#event}
  * The FetchEvent associated with the current request.
  *
  * @throws Will throw an error if the context does not have a FetchEvent.
  */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) return this.#executionCtx;
    else throw Error("This context has no FetchEvent");
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#executionctx}
  * The ExecutionContext associated with the current request.
  *
  * @throws Will throw an error if the context does not have an ExecutionContext.
  */
  get executionCtx() {
    if (this.#executionCtx) return this.#executionCtx;
    else throw Error("This context has no ExecutionContext");
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#res}
  * The Response object for the current request.
  */
  get res() {
    return this.#res ||= createResponseInstance(null, { headers: this.#preparedHeaders ??= new Headers() });
  }
  /**
  * Sets the Response object for the current request.
  *
  * @param _res - The Response object to set.
  */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") continue;
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) _res.headers.append("set-cookie", cookie);
        } else _res.headers.set(k, v);
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
  * `.render()` can create a response within a layout.
  *
  * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
  *
  * @example
  * ```ts
  * app.get('/', (c) => {
  *   return c.render('Hello!')
  * })
  * ```
  */
  render = /* @__PURE__ */ __name((...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  }, "render");
  /**
  * Sets the layout for the response.
  *
  * @param layout - The layout to set.
  * @returns The layout function.
  */
  setLayout = /* @__PURE__ */ __name((layout) => this.#layout = layout, "setLayout");
  /**
  * Gets the current layout for the response.
  *
  * @returns The current layout function.
  */
  getLayout = /* @__PURE__ */ __name(() => this.#layout, "getLayout");
  /**
  * `.setRenderer()` can set the layout in the custom middleware.
  *
  * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
  *
  * @example
  * ```tsx
  * app.use('*', async (c, next) => {
  *   c.setRenderer((content) => {
  *     return c.html(
  *       <html>
  *         <body>
  *           <p>{content}</p>
  *         </body>
  *       </html>
  *     )
  *   })
  *   await next()
  * })
  * ```
  */
  setRenderer = /* @__PURE__ */ __name((renderer) => {
    this.#renderer = renderer;
  }, "setRenderer");
  /**
  * `.header()` can set headers.
  *
  * @see {@link https://hono.dev/docs/api/context#header}
  *
  * @example
  * ```ts
  * app.get('/welcome', (c) => {
  *   // Set headers
  *   c.header('X-Message', 'Hello!')
  *   c.header('Content-Type', 'text/plain')
  *
  *   // Append multiple headers using the append option (e.g. Vary)
  *   c.header('Vary', 'Accept-Encoding', { append: true })
  *   c.header('Vary', 'User-Agent', { append: true })
  *
  *   return c.body('Thank you for coming')
  * })
  * ```
  */
  header = /* @__PURE__ */ __name((name, value, options) => {
    if (this.finalized) this.#res = createResponseInstance(this.#res.body, this.#res);
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) headers.delete(name);
    else if (options?.append) headers.append(name, value);
    else headers.set(name, value);
  }, "header");
  status = /* @__PURE__ */ __name((status) => {
    this.#status = status;
  }, "status");
  /**
  * `.set()` can set the value specified by the key.
  *
  * @see {@link https://hono.dev/docs/api/context#set-get}
  *
  * @example
  * ```ts
  * app.use('*', async (c, next) => {
  *   c.set('message', 'Hono is hot!!')
  *   await next()
  * })
  * ```
  */
  set = /* @__PURE__ */ __name((key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  }, "set");
  /**
  * `.get()` can use the value specified by the key.
  *
  * @see {@link https://hono.dev/docs/api/context#set-get}
  *
  * @example
  * ```ts
  * app.get('/', (c) => {
  *   const message = c.get('message')
  *   return c.text(`The message is "${message}"`)
  * })
  * ```
  */
  get = /* @__PURE__ */ __name((key) => {
    return this.#var ? this.#var.get(key) : void 0;
  }, "get");
  /**
  * `.var` can access the value of a variable.
  *
  * @see {@link https://hono.dev/docs/api/context#var}
  *
  * @example
  * ```ts
  * const result = c.var.client.oneMethod()
  * ```
  */
  get var() {
    if (!this.#var) return {};
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    let responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders;
    if (typeof arg === "object" && arg.headers) {
      responseHeaders ??= new Headers();
      for (const [key, value] of new Headers(arg.headers)) if (key === "set-cookie") responseHeaders.append(key, value);
      else responseHeaders.set(key, value);
    }
    if (headers) {
      if (!responseHeaders) {
        let count = 0;
        for (const k in headers) if (++count > 1 || typeof headers[k] !== "string") {
          responseHeaders = new Headers();
          break;
        }
      }
      if (responseHeaders) for (const k in headers) {
        const v = headers[k];
        if (typeof v === "string") responseHeaders.set(k, v);
        else {
          responseHeaders.delete(k);
          for (const v2 of v) responseHeaders.append(k, v2);
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, {
      status,
      headers: responseHeaders ?? headers
    });
  }
  newResponse = /* @__PURE__ */ __name((...args) => this.#newResponse(...args), "newResponse");
  /**
  * `.body()` can return the HTTP response.
  * You can set headers with `.header()` and set HTTP status code with `.status`.
  * This can also be set in `.text()`, `.json()` and so on.
  *
  * @see {@link https://hono.dev/docs/api/context#body}
  *
  * @example
  * ```ts
  * app.get('/welcome', (c) => {
  *   // Set headers
  *   c.header('X-Message', 'Hello!')
  *   c.header('Content-Type', 'text/plain')
  *   // Set HTTP status code
  *   c.status(201)
  *
  *   // Return the response body
  *   return c.body('Thank you for coming')
  * })
  * ```
  */
  body = /* @__PURE__ */ __name((data, arg, headers) => this.#newResponse(data, arg, headers), "body");
  /**
  * `.text()` can render text as `Content-Type:text/plain`.
  *
  * @see {@link https://hono.dev/docs/api/context#text}
  *
  * @example
  * ```ts
  * app.get('/say', (c) => {
  *   return c.text('Hello!')
  * })
  * ```
  */
  text = /* @__PURE__ */ __name((text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(text, arg, setDefaultContentType(TEXT_PLAIN, headers));
  }, "text");
  /**
  * `.json()` can render JSON as `Content-Type:application/json`.
  *
  * @see {@link https://hono.dev/docs/api/context#json}
  *
  * @example
  * ```ts
  * app.get('/api', (c) => {
  *   return c.json({ message: 'Hello!' })
  * })
  * ```
  */
  json = /* @__PURE__ */ __name((object, arg, headers) => {
    return this.#newResponse(JSON.stringify(object), arg, setDefaultContentType("application/json", headers));
  }, "json");
  html = /* @__PURE__ */ __name((html, arg, headers) => {
    const res = /* @__PURE__ */ __name((html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers)), "res");
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  }, "html");
  /**
  * `.redirect()` can Redirect, default status code is 302.
  *
  * @see {@link https://hono.dev/docs/api/context#redirect}
  *
  * @example
  * ```ts
  * app.get('/redirect', (c) => {
  *   return c.redirect('/')
  * })
  * app.get('/redirect-permanently', (c) => {
  *   return c.redirect('/', 301)
  * })
  * ```
  */
  redirect = /* @__PURE__ */ __name((location, status) => {
    const locationString = String(location);
    this.header("Location", !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString));
    return this.newResponse(null, status ?? 302);
  }, "redirect");
  /**
  * `.notFound()` can return the Not Found Response.
  *
  * @see {@link https://hono.dev/docs/api/context#notfound}
  *
  * @example
  * ```ts
  * app.get('/notfound', (c) => {
  *   return c.notFound()
  * })
  * ```
  */
  notFound = /* @__PURE__ */ __name(() => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  }, "notFound");
};

// node_modules/hono/dist/compose.js
var compose = /* @__PURE__ */ __name((middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) throw new Error("next() called multiple times");
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else handler = i === middleware.length && next || void 0;
      if (handler) try {
        res = await handler(context, () => dispatch(i + 1));
      } catch (err) {
        if (err instanceof Error && onError) {
          context.error = err;
          res = await onError(err, context);
          isError = true;
        } else throw err;
      }
      else if (context.finalized === false && onNotFound) res = await onNotFound(context);
      if (res && (context.finalized === false || isError)) context.res = res;
      return context;
    }
    __name(dispatch, "dispatch");
  };
}, "compose");

// node_modules/hono/dist/router.js
var METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "options",
  "patch",
  "query"
];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
  static {
    __name(this, "UnsupportedPathError");
  }
};

// node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/hono/dist/hono-base.js
var notFoundHandler = /* @__PURE__ */ __name((c) => {
  return c.text("404 Not Found", 404);
}, "notFoundHandler");
var errorHandler = /* @__PURE__ */ __name((err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
}, "errorHandler");
var Hono = class Hono2 {
  static {
    __name(this, "Hono");
  }
  get;
  post;
  put;
  delete;
  options;
  patch;
  query;
  all;
  on;
  use;
  router;
  getPath;
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    [...METHODS, "all"].forEach((method) => {
      this[method] = (args1, ...args) => {
        const methodName = method.toUpperCase();
        if (typeof args1 === "string") this.#path = args1;
        else this.#addRoute(methodName, this.#path, args1);
        args.forEach((handler) => {
          this.#addRoute(methodName, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          const methodName = m.toUpperCase();
          for (const handler of handlers) this.#addRoute(methodName, this.#path, handler);
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") this.#path = arg1;
      else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute("ALL", this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new Hono2({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  errorHandler = errorHandler;
  /**
  * `.route()` allows grouping other Hono instance in routes.
  *
  * @see {@link https://hono.dev/docs/api/routing#grouping}
  *
  * @param {string} path - base Path
  * @param {Hono} app - other Hono instance
  * @returns {Hono} routed Hono instance
  *
  * @example
  * ```ts
  * const app = new Hono()
  * const app2 = new Hono()
  *
  * app2.get("/user", (c) => c.text("user"))
  * app.route("/api", app2) // GET /api/user
  * ```
  */
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r) => {
      let handler;
      if (app2.errorHandler === errorHandler) handler = r.handler;
      else {
        handler = /* @__PURE__ */ __name(async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res, "handler");
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler, r.basePath);
    });
    return this;
  }
  /**
  * `.basePath()` allows base paths to be specified.
  *
  * @see {@link https://hono.dev/docs/api/routing#base-path}
  *
  * @param {string} path - base Path
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * const api = new Hono().basePath('/api')
  * ```
  */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
  * `.onError()` handles an error and returns a customized Response.
  *
  * @see {@link https://hono.dev/docs/api/hono#error-handling}
  *
  * @param {ErrorHandler} handler - request Handler for error
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * app.onError((err, c) => {
  *   console.error(`${err}`)
  *   return c.text('Custom Error Message', 500)
  * })
  * ```
  */
  onError = /* @__PURE__ */ __name((handler) => {
    this.errorHandler = handler;
    return this;
  }, "onError");
  /**
  * `.notFound()` allows you to customize a Not Found Response.
  *
  * @see {@link https://hono.dev/docs/api/hono#not-found}
  *
  * @param {NotFoundHandler} handler - request handler for not-found
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * app.notFound((c) => {
  *   return c.text('Custom 404 Message', 404)
  * })
  * ```
  */
  notFound = /* @__PURE__ */ __name((handler) => {
    this.#notFoundHandler = handler;
    return this;
  }, "notFound");
  /**
  * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
  *
  * @deprecated Use `mount()` from `hono/mount` instead. `.mount()` will be removed in v5.
  *
  * @see {@link https://hono.dev/docs/api/hono#mount}
  *
  * @param {string} path - base Path
  * @param {Function} applicationHandler - other Request Handler
  * @param {MountOptions} [options] - options of `.mount()`
  * @returns {Hono} mounted Hono instance
  *
  * @example
  * ```ts
  * import { Router as IttyRouter } from 'itty-router'
  * import { Hono } from 'hono'
  * // Create itty-router application
  * const ittyRouter = IttyRouter()
  * // GET /itty-router/hello
  * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
  *
  * const app = new Hono()
  * app.mount('/itty-router', ittyRouter.handle)
  * ```
  *
  * @example
  * ```ts
  * const app = new Hono()
  * // Send the request to another application without modification.
  * app.mount('/app', anotherApp, {
  *   replaceRequest: (req) => req,
  * })
  * ```
  */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") optionHandler = options;
      else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) replaceRequest = /* @__PURE__ */ __name((request) => request, "replaceRequest");
        else replaceRequest = options.replaceRequest;
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = this.getPath(request).slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = /* @__PURE__ */ __name(async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) return res;
      await next();
    }, "handler");
    this.#addRoute("ALL", mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler, baseRoutePath) {
    path = mergePath(this._basePath, path);
    const r = {
      basePath: baseRoutePath !== void 0 ? mergePath(this._basePath, baseRoutePath) : this._basePath,
      path,
      method,
      handler
    };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) return this.errorHandler(err, c);
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then((resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) throw new Error("Context is not finalized. Did you forget to return a Response object or `await next()`?");
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
  * `.fetch()` will be entry point of your app.
  *
  * @see {@link https://hono.dev/docs/api/hono#fetch}
  *
  * @param {Request} request - request Object of request
  * @param {Env} env - env Object
  * @param {ExecutionContext} executionCtx - context of execution
  * @returns {Response | Promise<Response>} response of request
  *
  */
  fetch = /* @__PURE__ */ __name((request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  }, "fetch");
  /**
  * `.request()` is a useful method for testing.
  * You can pass a URL or pathname to send a GET request.
  * app will return a Response object.
  * ```ts
  * test('GET /hello is ok', async () => {
  *   const res = await app.request('/hello')
  *   expect(res.status).toBe(200)
  * })
  * ```
  * @see https://hono.dev/docs/api/hono#request
  */
  request = /* @__PURE__ */ __name((input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    input = input.toString();
    return this.fetch(new Request(/^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`, requestInit), Env, executionCtx);
  }, "request");
  /**
  * `.fire()` automatically adds a global fetch event listener.
  * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
  * @deprecated
  * Use `fire` from `hono/service-worker` instead.
  * ```ts
  * import { Hono } from 'hono'
  * import { fire } from 'hono/service-worker'
  *
  * const app = new Hono()
  * // ...
  * fire(app)
  * ```
  * @see https://hono.dev/docs/api/hono#fire
  * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
  * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
  */
  fire = /* @__PURE__ */ __name(() => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  }, "fire");
};

// node_modules/hono/dist/router/utils.js
var createNullObject = /* @__PURE__ */ __name(() => /* @__PURE__ */ Object.create(null), "createNullObject");

// node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = /* @__PURE__ */ __name(((method2, path2) => {
    const matcher = matchers[method2] || matchers["ALL"];
    const staticMatch = matcher[2][path2];
    if (staticMatch) return staticMatch;
    const match3 = path2.match(matcher[0]);
    if (!match3) return [[], emptyParam];
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  }), "match");
  this.match = match2;
  return match2(method, path);
}
__name(match, "match");

// node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = /* @__PURE__ */ new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) return b.length === 1 ? a < b ? -1 : 1 : -1;
  if (b.length === 1) return 1;
  if (a === ".*" || a === "(?:|/.*)") return b === "(?:|/.*)" ? -1 : 1;
  else if (b === ".*" || b === "(?:|/.*)") return -1;
  if (a === "[^/]+") return 1;
  else if (b === "[^/]+") return -1;
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
__name(compareKey, "compareKey");
var Node = class Node2 {
  static {
    __name(this, "Node");
  }
  #index;
  #varIndex;
  #children = createNullObject();
  insert(tokens, index, paramMap, context, isStatic) {
    let node = this;
    for (let i = 0, len = tokens.length; i < len; i++) {
      const token = tokens[i];
      const pattern = token.length === 1 ? token === "*" ? i === len - 1 ? [
        "",
        "",
        ".*"
      ] : [
        "",
        "",
        LABEL_REG_EXP_STR
      ] : null : token === "/*" ? [
        "",
        "",
        TAIL_WILDCARD_REG_EXP_STR
      ] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
      let nextNode;
      if (pattern) {
        const name = pattern[1];
        let regexpStr = pattern[2] || "[^/]+";
        if (name && pattern[2]) {
          if (regexpStr === ".*") throw PATH_ERROR;
          regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
          if (/\((?!\?:)/.test(regexpStr)) throw PATH_ERROR;
          if (regexpStr.length === 1 && regExpMetaChars.has(regexpStr)) throw PATH_ERROR;
        }
        nextNode = node.#children[regexpStr];
        if (!nextNode) {
          if (regexpStr !== ".*" && regexpStr !== "(?:|/.*)") {
            for (const k in node.#children) if ((regexpStr.length > 1 || k.length > 1) && k !== ".*" && k !== "(?:|/.*)") throw PATH_ERROR;
          }
          nextNode = node.#children[regexpStr] = new Node2();
        }
        if (name !== "") {
          nextNode.#varIndex ??= context.varIndex++;
          paramMap.push([name, nextNode.#varIndex]);
        }
      } else {
        nextNode = node.#children[token];
        if (!nextNode) {
          for (const k in node.#children) if (k.length > 1 && k !== ".*" && k !== "(?:|/.*)") throw PATH_ERROR;
          nextNode = node.#children[token] = new Node2();
        }
      }
      node = nextNode;
    }
    if (node.#index !== void 0) throw PATH_ERROR;
    node.#index = isStatic ? -1 : index;
  }
  buildRegExpStr() {
    const strList = Object.keys(this.#children).sort(compareKey).map((k) => {
      const c = this.#children[k];
      const childStr = c.buildRegExpStr();
      return childStr === "" ? "" : (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + childStr;
    }).filter(Boolean);
    if (typeof this.#index === "number" && this.#index !== -1) strList.unshift(`#${this.#index}`);
    if (strList.length === 0) return "";
    if (strList.length === 1) return strList[0];
    return "(?:" + strList.join("|") + ")";
  }
};

// node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  static {
    __name(this, "Trie");
  }
  #context = { varIndex: 0 };
  #root = new Node();
  #index = 0;
  paths = createNullObject();
  insert(path, isStatic) {
    if (isStatic) {
      this.#root.insert(path.split(""), 0, [], this.#context, true);
      return;
    }
    const paramAssoc = [];
    const groups = [];
    let markedPath = path;
    for (let i = 0; ; ) {
      let replaced = false;
      markedPath = markedPath.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) break;
    }
    const tokens = markedPath.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) if (tokens[j].indexOf(mark) !== -1) {
        tokens[j] = tokens[j].replace(mark, groups[i][1]);
        break;
      }
    }
    this.#root.insert(tokens, this.#index, paramAssoc, this.#context, false);
    this.paths[path] = [this.#index++, paramAssoc];
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") return [
      /^$/,
      [],
      []
    ];
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [
      new RegExp(`^${regexp}`),
      indexReplacementMap,
      paramReplacementMap
    ];
  }
};

// node_modules/hono/dist/router/reg-exp-router/router.js
var wildcardRegExpCache = createNullObject();
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(`^${path.replace(/\/:[^/{}]+(?:\{\[\^\/]\+})?(?=[/{]|$)|\/?\*$|([.\\+*[^\]$()?{}|])/g, (match2, metaChar) => metaChar ? `\\${metaChar}` : match2 === "/*" ? TAIL_WILDCARD_REG_EXP_STR : match2 === "*" ? ".*" : `/:${LABEL_REG_EXP_STR}`)}$`);
}
__name(buildWildcardRegExp, "buildWildcardRegExp");
function findMiddleware(middleware, path) {
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) if (buildWildcardRegExp(k).test(path)) return [...middleware[k]];
}
__name(findMiddleware, "findMiddleware");
var RegExpRouter = class {
  static {
    __name(this, "RegExpRouter");
  }
  name = "RegExpRouter";
  #middleware;
  #routes;
  #tries;
  constructor() {
    this.#middleware = { ["ALL"]: createNullObject() };
    this.#routes = { ["ALL"]: createNullObject() };
    this.#tries = { ["ALL"]: new Trie() };
  }
  #insertPath(method, path) {
    try {
      this.#tries[method].insert(path, !/\*|\/:/.test(path));
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware) throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    if (!middleware[method]) {
      this.#tries[method] = new Trie();
      for (const handlerMap of [middleware, routes]) {
        handlerMap[method] = createNullObject();
        for (const p in handlerMap["ALL"]) {
          handlerMap[method][p] = [...handlerMap["ALL"][p]];
          this.#insertPath(method, p);
        }
      }
    }
    if (path === "/*") path = "*";
    const methods = method === "ALL" ? Object.keys(middleware) : [method];
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      for (const m of methods) if (!middleware[m][path]) {
        this.#insertPath(m, path);
        middleware[m][path] = findMiddleware(middleware[m], path) || findMiddleware(middleware["ALL"], path) || [];
      }
      for (const handlerMap of [middleware, routes]) for (const m of methods) for (const p in handlerMap[m]) re.test(p) && handlerMap[m][p].push([handler, path]);
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (const path2 of paths) for (const m of methods) {
      if (!routes[m][path2]) {
        this.#insertPath(m, path2);
        routes[m][path2] = findMiddleware(middleware[m], path2) || findMiddleware(middleware["ALL"], path2) || [];
      }
      routes[m][path2].push([handler, path2]);
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = createNullObject();
    for (const method of Object.keys(this.#routes)) matchers[method] = this.#buildMatcher(method);
    this.#middleware = this.#routes = this.#tries = void 0;
    wildcardRegExpCache = createNullObject();
    return matchers;
  }
  #buildMatcher(method) {
    const middleware = this.#middleware[method];
    const routes = this.#routes[method];
    const trie = this.#tries[method];
    const staticMap = createNullObject();
    const handlerData = [];
    const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
    for (const r of [middleware, routes]) for (const path in r) {
      const handlers = r[path];
      const pathData = trie.paths[path];
      if (!pathData) {
        staticMap[path] = [handlers.map(([h]) => [h, createNullObject()]), emptyParam];
        continue;
      }
      handlerData[pathData[0]] = handlers.map(([h, handlerPath]) => [h, trie.paths[handlerPath][1].reduceRight((map, [key], i) => {
        map[key] = paramReplacementMap[pathData[1][i][1]];
        return map;
      }, createNullObject())]);
    }
    return [
      regexp,
      indexReplacementMap.map((i) => handlerData[i]),
      staticMap
    ];
  }
};

// node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  static {
    __name(this, "SmartRouter");
  }
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    this.#routes.push([
      method,
      path,
      handler
    ]);
  }
  match(method, path) {
    if (!this.#routes) throw new Error("Fatal error");
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) router.add(...routes[i2]);
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) continue;
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) throw new Error("Fatal error");
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) throw new Error("No active router has been determined yet.");
    return this.#routers[0];
  }
};

// node_modules/hono/dist/router/trie-router/node.js
var emptyParams = createNullObject();
var order = 0;
var Node3 = class Node4 {
  static {
    __name(this, "Node");
  }
  #methods = [];
  #children = createNullObject();
  #patterns = [];
  #pattern;
  #params = emptyParams;
  insert(method, path, handler) {
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = /* @__PURE__ */ new Set();
    let i = 0;
    for (const p of parts) {
      const nextP = parts[++i];
      const pattern = getPattern(p, nextP) || (nextP === void 0 && p && p.indexOf("*") === p.length - 1 ? p : null);
      const isParam = Array.isArray(pattern);
      const key = isParam ? pattern[0] : pattern || p;
      const child = curNode.#children[key] ||= new Node4();
      if (pattern && !child.#pattern) {
        child.#pattern = pattern;
        curNode.#patterns.push(child);
      }
      curNode = child;
      if (isParam) possibleKeys.add(pattern[1]);
    }
    curNode.#methods.push({ [method]: {
      handler,
      possibleKeys: [...possibleKeys],
      score: ++order
    } });
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m["ALL"];
      if (handlerSet) {
        handlerSet.params = createNullObject();
        handlerSets.push(handlerSet);
        for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
          const key = handlerSet.possibleKeys[i2];
          handlerSet.params[key] = params?.[key] && !i2 ? params[key] : nodeParams[key] ?? params?.[key];
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    let curNodes = [this];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else tempNodes.push(nextNode);
        }
        for (const child of node.#patterns) {
          const pattern = child.#pattern;
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (typeof pattern === "string") {
            if (pattern === "*" || part.startsWith(pattern.slice(0, -1))) {
              this.#pushHandlerSets(handlerSets, child, method, node.#params);
              if (pattern === "*") {
                child.#params = params;
                tempNodes.push(child);
              }
            }
            continue;
          }
          const [, name, matcher] = pattern;
          if (!part && matcher === true) continue;
          if (matcher !== true) {
            if (!partOffsets) {
              partOffsets = [];
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.slice(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              if (!Object.hasOwn(params, name)) params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (m[0].length === restPathString.length && child.#children["*"]) this.#pushHandlerSets(handlerSets, child.#children["*"], method, node.#params, params);
              for (const _ in child.#children) {
                child.#params = params;
                const componentCount = m[0].match(/\//g)?.length ?? 0;
                (curNodesQueue[componentCount] ||= []).push(child);
                break;
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            if (!Object.hasOwn(params, name)) params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) this.#pushHandlerSets(handlerSets, child.#children["*"], method, params, node.#params);
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets[1]) handlerSets.sort((a, b) => {
      return a.score - b.score;
    });
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  static {
    __name(this, "TrieRouter");
  }
  name = "TrieRouter";
  #node = new Node3();
  add(method, path, handler) {
    for (const result of checkOptionalParameter(path) || [path]) this.#node.insert(method, result, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// node_modules/hono/dist/hono.js
var Hono3 = class extends Hono {
  static {
    __name(this, "Hono");
  }
  /**
  * Creates an instance of the Hono class.
  *
  * @param options - Optional configuration options for the Hono instance.
  */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({ routers: [new RegExpRouter(), new TrieRouter()] });
  }
};

// src/env.js
function getRequiredEnv(env, name) {
  const value = env ? env[name] : void 0;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("missing env: " + name);
  }
  return value;
}
__name(getRequiredEnv, "getRequiredEnv");

// src/crypto.js
var encoder = new TextEncoder();
var HEX_64 = /^[a-f\d]{64}$/i;
function toHex(buffer) {
  let out = "";
  for (const byte of new Uint8Array(buffer)) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}
__name(toHex, "toHex");
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(text)));
  return toHex(digest);
}
__name(sha256Hex, "sha256Hex");
async function hmacSha256Hex(key, text) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(key)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(String(text)));
  return toHex(signature);
}
__name(hmacSha256Hex, "hmacSha256Hex");
function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (!HEX_64.test(a) || !HEX_64.test(b)) return false;
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}
__name(timingSafeEqualHex, "timingSafeEqualHex");

// src/national-id.js
function normalizeNationalId(input) {
  return String(input ?? "").replace(/\D/g, "");
}
__name(normalizeNationalId, "normalizeNationalId");
async function nationalIdHash(normalized, pepper) {
  return hmacSha256Hex(pepper, normalized);
}
__name(nationalIdHash, "nationalIdHash");

// src/cookie.js
var sessionCookieName = "hr_session";
var DEFAULT_MAX_AGE = 43200;
function parseCookies(headerValue) {
  const cookies = {};
  if (typeof headerValue !== "string" || headerValue.length === 0) return cookies;
  for (const pair of headerValue.split(";")) {
    const trimmed = pair.trim();
    if (trimmed.length === 0) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    if (name.length === 0) continue;
    const rawValue = trimmed.slice(separator + 1).trim();
    if (Object.prototype.hasOwnProperty.call(cookies, name)) continue;
    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      value = rawValue;
    }
    cookies[name] = value;
  }
  return cookies;
}
__name(parseCookies, "parseCookies");
function sessionCookieOptions({ secure = true } = {}) {
  return {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    maxAge: DEFAULT_MAX_AGE,
    secure
  };
}
__name(sessionCookieOptions, "sessionCookieOptions");
function serializeCookie(name, value, options = {}) {
  const maxAge = Number.isFinite(options.maxAge) ? options.maxAge : DEFAULT_MAX_AGE;
  const parts = [
    `${name}=${encodeURIComponent(value ?? "")}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAge}`
  ];
  if (options.secure === true) parts.push("Secure");
  return parts.join("; ");
}
__name(serializeCookie, "serializeCookie");

// src/pin-rules.js
var PIN_PATTERN = /^\d{6}$/;
var REPEATED_PIN = /^(\d)\1{5}$/;
var SEQUENTIAL_PINS = ["0123456789", "9876543210"];
var MESSAGE_FORMAT = "PIN \u0E15\u0E49\u0E2D\u0E07\u0E40\u0E1B\u0E47\u0E19\u0E15\u0E31\u0E27\u0E40\u0E25\u0E02 6 \u0E2B\u0E25\u0E31\u0E01";
var MESSAGE_TOO_SIMPLE = "PIN \u0E07\u0E48\u0E32\u0E22\u0E40\u0E01\u0E34\u0E19\u0E44\u0E1B \u0E01\u0E23\u0E38\u0E13\u0E32\u0E15\u0E31\u0E49\u0E07\u0E43\u0E2B\u0E21\u0E48";
function validatePin(pin) {
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
    return { ok: false, message: MESSAGE_FORMAT };
  }
  if (REPEATED_PIN.test(pin)) {
    return { ok: false, message: MESSAGE_TOO_SIMPLE };
  }
  if (SEQUENTIAL_PINS.some((sequence) => sequence.includes(pin))) {
    return { ok: false, message: MESSAGE_TOO_SIMPLE };
  }
  return { ok: true };
}
__name(validatePin, "validatePin");
async function pinHash(pepper, employeeId, pin) {
  return hmacSha256Hex(pepper, `${employeeId}:${pin}`);
}
__name(pinHash, "pinHash");

// src/db.js
var CONTENT_TYPE = "application/json";
function encodeValue(value) {
  return value === null ? "null" : encodeURIComponent(String(value));
}
__name(encodeValue, "encodeValue");
function buildFilters(filters = []) {
  const parts = [];
  for (const [column, op, value] of filters) {
    const name = encodeURIComponent(column);
    if (op === "is") {
      parts.push(`${name}=is.${value === null ? "null" : encodeValue(value)}`);
      continue;
    }
    parts.push(`${name}=${op}.${encodeValue(value)}`);
  }
  return parts;
}
__name(buildFilters, "buildFilters");
function createDb(env) {
  const baseUrl = getRequiredEnv(env, "SUPABASE_URL").trim().replace(/\/+$/, "");
  const apiKey = getRequiredEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  function headers() {
    return {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": CONTENT_TYPE
    };
  }
  __name(headers, "headers");
  function url(table, queryParts = []) {
    const base = `${baseUrl}/rest/v1/${encodeURIComponent(table)}`;
    return queryParts.length > 0 ? `${base}?${queryParts.join("&")}` : base;
  }
  __name(url, "url");
  async function readError(response) {
    let code = null;
    try {
      const body = await response.json();
      if (body && typeof body.code === "string") code = body.code;
    } catch {
      code = null;
    }
    return { code };
  }
  __name(readError, "readError");
  async function select(table, { columns = "*", filters = [], order: order2, limit, single = false, extra = [] } = {}) {
    const query = [`select=${columns}`, ...buildFilters(filters), ...extra];
    if (typeof order2 === "string" && order2.length > 0) query.push(`order=${order2}`);
    const effectiveLimit = single ? 1 : limit;
    if (typeof effectiveLimit === "number" && Number.isFinite(effectiveLimit)) {
      query.push(`limit=${effectiveLimit}`);
    }
    const response = await fetch(url(table, query), { method: "GET", headers: headers() });
    if (!response.ok) {
      const error = new Error("postgrest request failed");
      error.status = response.status;
      error.code = (await readError(response)).code;
      throw error;
    }
    const data = await response.json().catch(() => null);
    if (single) return Array.isArray(data) && data.length > 0 ? data[0] : null;
    return Array.isArray(data) ? data : [];
  }
  __name(select, "select");
  async function insert(table, row, { returning = false } = {}) {
    const requestHeaders = headers();
    if (returning) requestHeaders.Prefer = "return=representation";
    const response = await fetch(url(table), {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(row)
    });
    if (!response.ok) return { error: await readError(response) };
    if (!returning) return { error: null };
    const data = await response.json().catch(() => null);
    return {
      data: Array.isArray(data) ? data[0] ?? null : data ?? null,
      error: null
    };
  }
  __name(insert, "insert");
  async function update(table, patch, filters = [], { returning = false, columns = "*" } = {}) {
    const requestHeaders = headers();
    if (returning) {
      requestHeaders.Prefer = "return=representation";
    }
    const response = await fetch(url(table, returning ? [`select=${columns}`, ...buildFilters(filters)] : buildFilters(filters)), {
      method: "PATCH",
      headers: requestHeaders,
      body: JSON.stringify(patch)
    });
    if (!response.ok) return { error: await readError(response) };
    if (!returning) return { error: null };
    const data = await response.json().catch(() => null);
    return { data: Array.isArray(data) ? data : [], error: null };
  }
  __name(update, "update");
  async function upsert(table, row, { conflict, columns = "*" } = {}) {
    const requestHeaders = headers();
    requestHeaders.Prefer = "return=representation,resolution=merge-duplicates";
    const queryParts = conflict ? [`onConflict=${encodeURIComponent(conflict)}`, `select=${columns}`] : [`select=${columns}`];
    const response = await fetch(url(table, queryParts), {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(row)
    });
    if (!response.ok) return { error: await readError(response) };
    const data = await response.json().catch(() => null);
    return {
      data: Array.isArray(data) ? data[0] ?? null : data ?? null,
      error: null
    };
  }
  __name(upsert, "upsert");
  return { select, insert, update, upsert };
}
__name(createDb, "createDb");

// src/session.js
var SESSION_HOURS = 12;
var SESSION_IDLE_MS = 15 * 60 * 1e3;
var SESSIONS_TABLE = "auth_sessions";
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(base64Url, "base64Url");
function landingPathFor(loginRole, hasPending) {
  if (loginRole === "employee") return hasPending ? "/leave/approvals" : "/leave";
  if (loginRole === "hr") return "/leave/hr";
  if (loginRole === "meeting_controller" || loginRole === "controller") return "/meeting/controller";
  if (loginRole === "system_admin" || loginRole === "system") return "/admin";
  return "/login";
}
__name(landingPathFor, "landingPathFor");
async function allowedLoginTypesFor(env, employeeId) {
  const db = createDb(env);
  const one = /* @__PURE__ */ __name(async (table) => {
    const row = await db.select(table, {
      columns: "employee_id",
      filters: [["employee_id", "eq", employeeId]],
      single: true
    });
    return row !== null;
  }, "one");
  if (await one("hr_admins")) return ["hr"];
  if (await one("meeting_admins")) return ["meeting_controller"];
  if (await one("system_admins")) return ["system_admin"];
  return ["employee"];
}
__name(allowedLoginTypesFor, "allowedLoginTypesFor");
async function revokeSession(env, id) {
  const db = createDb(env);
  return db.update(
    SESSIONS_TABLE,
    { revoked_at: (/* @__PURE__ */ new Date()).toISOString() },
    [
      ["id", "eq", id],
      ["revoked_at", "is", null]
    ]
  );
}
__name(revokeSession, "revokeSession");
async function createSession(env, employeeId, loginRole) {
  const db = createDb(env);
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = base64Url(bytes);
  const now = /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  const expiresIso = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1e3).toISOString();
  const { error } = await db.insert(SESSIONS_TABLE, {
    token_hash: await sha256Hex(token),
    employee_id: employeeId,
    login_role: loginRole,
    created_at: nowIso,
    last_active_at: nowIso,
    expires_at: expiresIso
  });
  if (error) throw new Error("failed to create session");
  return token;
}
__name(createSession, "createSession");
async function readSession(env, token) {
  if (!token) return { ok: false };
  try {
    const db = createDb(env);
    const now = /* @__PURE__ */ new Date();
    const session = await db.select(SESSIONS_TABLE, {
      columns: "*",
      filters: [
        ["token_hash", "eq", await sha256Hex(token)],
        ["revoked_at", "is", null],
        ["expires_at", "gt", now.toISOString()]
      ],
      single: true
    });
    if (!session) return { ok: false };
    const lastActiveMs = new Date(session.last_active_at).getTime();
    if (!Number.isFinite(lastActiveMs) || now.getTime() - lastActiveMs > SESSION_IDLE_MS) {
      await revokeSession(env, session.id);
      return { ok: false };
    }
    const employee = await db.select("employees", {
      columns: "*",
      filters: [["id", "eq", session.employee_id]],
      single: true
    });
    if (!employee || employee.is_active !== true) {
      await revokeSession(env, session.id);
      return { ok: false };
    }
    const allowed = await allowedLoginTypesFor(env, employee.id);
    if (!allowed.includes(session.login_role)) {
      await revokeSession(env, session.id);
      return { ok: false };
    }
    await db.update(
      SESSIONS_TABLE,
      { last_active_at: now.toISOString() },
      [
        ["id", "eq", session.id],
        ["revoked_at", "is", null]
      ]
    );
    const role = session.login_role;
    if (role === "employee") {
      const pending = await db.select("leave_requests", {
        columns: "id",
        filters: [
          ["approver_id", "eq", employee.id],
          ["status", "eq", "pending"]
        ],
        single: true
      });
      const target = landingPathFor(role, pending !== null);
      return {
        ok: true,
        employeeId: employee.id,
        role,
        redirectTo: "/pending?to=" + encodeURIComponent(target)
      };
    }
    return {
      ok: true,
      employeeId: employee.id,
      role,
      redirectTo: landingPathFor(role, false)
    };
  } catch {
    return { ok: false };
  }
}
__name(readSession, "readSession");

// src/routes/auth.js
var auth = new Hono3();
var SESSIONS_TABLE2 = "auth_sessions";
var CREDENTIALS_TABLE = "employee_credentials";
var RESET_CODES_TABLE = "pin_reset_codes";
var AUDIT_TABLE = "audit_logs";
var MAX_FAILED_ATTEMPTS = 5;
var LOCK_MINUTES = 15;
var LOCK_MS = LOCK_MINUTES * 60 * 1e3;
var RESET_CODE_MAX_ATTEMPTS = 5;
var LOGIN_ROLES = {
  employee: "employee",
  hr: "hr",
  controller: "meeting_controller",
  system: "system_admin"
};
var INVALID_MESSAGE = "\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07";
var LOGIN_INVALID_MESSAGE = "\u0E40\u0E25\u0E02\u0E1A\u0E31\u0E15\u0E23\u0E1B\u0E23\u0E30\u0E0A\u0E32\u0E0A\u0E19\u0E2B\u0E23\u0E37\u0E2D PIN \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07";
var LOCKED_MESSAGE = "\u0E1A\u0E31\u0E0D\u0E0A\u0E35\u0E16\u0E39\u0E01\u0E25\u0E47\u0E2D\u0E01\u0E0A\u0E31\u0E48\u0E27\u0E04\u0E23\u0E32\u0E27";
var CONNECTION_MESSAGE = "\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E44\u0E14\u0E49 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48";
var UNAUTHENTICATED_MESSAGE = "\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E39\u0E48\u0E23\u0E30\u0E1A\u0E1A";
var LOGOUT_FAILED_MESSAGE = "\u0E23\u0E30\u0E1A\u0E1A\u0E02\u0E31\u0E14\u0E02\u0E49\u0E2D\u0E07\u0E0A\u0E31\u0E48\u0E27\u0E04\u0E23\u0E32\u0E27 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07";
var SET_PIN_INVALID_MESSAGE = "\u0E40\u0E25\u0E02\u0E1A\u0E31\u0E15\u0E23\u0E1B\u0E23\u0E30\u0E0A\u0E32\u0E0A\u0E19\u0E2B\u0E23\u0E37\u0E2D\u0E23\u0E2B\u0E31\u0E2A\u0E08\u0E32\u0E01 HR \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07";
var PIN_CONFIRM_MESSAGE = "PIN \u0E17\u0E31\u0E49\u0E07\u0E2A\u0E2D\u0E07\u0E0A\u0E48\u0E2D\u0E07\u0E44\u0E21\u0E48\u0E15\u0E23\u0E07\u0E01\u0E31\u0E19";
var SET_PIN_FAILED_MESSAGE = "\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E15\u0E31\u0E49\u0E07 PIN \u0E44\u0E14\u0E49 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48";
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
__name(isPlainObject, "isPlainObject");
function hasExactStringKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  if (Object.keys(value).length !== keys.length) return false;
  return keys.every(
    (key) => Object.prototype.hasOwnProperty.call(value, key) && typeof value[key] === "string"
  );
}
__name(hasExactStringKeys, "hasExactStringKeys");
async function readJson(c) {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}
__name(readJson, "readJson");
function secureCookie(env) {
  return env.COOKIE_SECURE !== "false";
}
__name(secureCookie, "secureCookie");
function clearSessionCookie(env) {
  const options = { ...sessionCookieOptions({ secure: secureCookie(env) }), maxAge: 0 };
  return serializeCookie(sessionCookieName, "", options);
}
__name(clearSessionCookie, "clearSessionCookie");
function setSessionCookie(c, env, token) {
  c.header(
    "Set-Cookie",
    serializeCookie(sessionCookieName, token, sessionCookieOptions({ secure: secureCookie(env) }))
  );
}
__name(setSessionCookie, "setSessionCookie");
function logFailure(scope, error) {
  console.error(scope, { name: error && error.name, code: error && error.code });
}
__name(logFailure, "logFailure");
function ensureOk(result) {
  if (result && result.error) {
    const error = new Error("database write failed");
    error.code = result.error.code;
    throw error;
  }
  return result;
}
__name(ensureOk, "ensureOk");
function failedAttempts(value) {
  const attempts = Number(value);
  return Number.isFinite(attempts) ? attempts : 0;
}
__name(failedAttempts, "failedAttempts");
auth.post("/login", async (c) => {
  try {
    const body = await readJson(c);
    if (!hasExactStringKeys(body, ["loginType", "nationalId", "pin"])) {
      return c.json({ ok: false, message: INVALID_MESSAGE }, 400);
    }
    if (!Object.prototype.hasOwnProperty.call(LOGIN_ROLES, body.loginType)) {
      return c.json({ ok: false, message: INVALID_MESSAGE }, 400);
    }
    const normalized = normalizeNationalId(body.nationalId);
    if (!/^\d{13}$/.test(normalized) || !/^\d{6}$/.test(body.pin)) {
      return c.json({ ok: false, message: INVALID_MESSAGE }, 400);
    }
    const env = c.env;
    const role = LOGIN_ROLES[body.loginType];
    const db = createDb(env);
    const now = /* @__PURE__ */ new Date();
    const nowIso = now.toISOString();
    const nationalHash = await nationalIdHash(
      normalized,
      getRequiredEnv(env, "NATIONAL_ID_PEPPER")
    );
    const credential = await db.select(CREDENTIALS_TABLE, {
      columns: "*",
      filters: [["national_id_hash", "eq", nationalHash]],
      single: true
    });
    const employee = credential ? await db.select("employees", {
      columns: "id,full_name,employee_code,is_active",
      filters: [["id", "eq", credential.employee_id]],
      single: true
    }) : null;
    if (!credential || !employee || employee.is_active !== true || credential.pin_hash === null || credential.pin_hash === void 0) {
      return c.json({ ok: false, message: LOGIN_INVALID_MESSAGE }, 401);
    }
    const lockedUntilMs = credential.locked_until ? new Date(credential.locked_until).getTime() : NaN;
    if (Number.isFinite(lockedUntilMs) && lockedUntilMs > now.getTime()) {
      return c.json(
        { ok: false, message: LOCKED_MESSAGE, lockedUntil: new Date(lockedUntilMs).toISOString() },
        423
      );
    }
    const expected = await hmacSha256Hex(
      getRequiredEnv(env, "PIN_PEPPER"),
      `${employee.id}:${body.pin}`
    );
    const pinOk = timingSafeEqualHex(expected, credential.pin_hash);
    let roleOk = false;
    if (pinOk) {
      const allowed = await allowedLoginTypesFor(env, employee.id);
      roleOk = allowed.includes(role);
    }
    if (!pinOk || !roleOk) {
      const attempts = failedAttempts(credential.failed_attempts) + 1;
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        const lockedUntil = new Date(now.getTime() + LOCK_MS).toISOString();
        ensureOk(
          await db.update(
            CREDENTIALS_TABLE,
            { failed_attempts: 0, locked_until: lockedUntil, updated_at: nowIso },
            [["employee_id", "eq", employee.id]]
          )
        );
        return c.json({ ok: false, message: LOCKED_MESSAGE, lockedUntil }, 423);
      }
      ensureOk(
        await db.update(
          CREDENTIALS_TABLE,
          { failed_attempts: attempts, updated_at: nowIso },
          [["employee_id", "eq", employee.id]]
        )
      );
      return c.json({ ok: false, message: LOGIN_INVALID_MESSAGE }, 401);
    }
    ensureOk(
      await db.update(
        CREDENTIALS_TABLE,
        { failed_attempts: 0, locked_until: null, updated_at: nowIso },
        [["employee_id", "eq", employee.id]]
      )
    );
    const token = await createSession(env, employee.id, role);
    let redirectTo;
    if (role === "employee") {
      const pending = await db.select("leave_requests", {
        columns: "id",
        filters: [
          ["approver_id", "eq", employee.id],
          ["status", "eq", "pending"]
        ],
        single: true
      });
      redirectTo = "/pending?to=" + encodeURIComponent(landingPathFor(role, pending !== null));
    } else {
      redirectTo = landingPathFor(role, false);
    }
    setSessionCookie(c, env, token);
    return c.json({ ok: true, redirectTo }, 200);
  } catch (error) {
    logFailure("auth login failed", error);
    return c.json({ ok: false, message: CONNECTION_MESSAGE }, 500);
  }
});
auth.get("/me", async (c) => {
  try {
    const token = parseCookies(c.req.header("Cookie"))[sessionCookieName];
    const session = await readSession(c.env, token);
    if (!session.ok) {
      return c.json({ ok: false, message: UNAUTHENTICATED_MESSAGE }, 401);
    }
    return c.json(
      { ok: true, role: session.role, redirectTo: session.redirectTo },
      200
    );
  } catch (error) {
    logFailure("auth me failed", error);
    return c.json({ ok: false, message: CONNECTION_MESSAGE }, 500);
  }
});
auth.post("/logout", async (c) => {
  const env = c.env;
  c.header("Cache-Control", "no-store");
  try {
    const token = parseCookies(c.req.header("Cookie"))[sessionCookieName];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (token) {
      const db = createDb(env);
      const tokenHash = await sha256Hex(token);
      const session = await db.select(SESSIONS_TABLE2, {
        columns: "id,employee_id",
        filters: [
          ["token_hash", "eq", tokenHash],
          ["revoked_at", "is", null]
        ],
        single: true
      });
      if (session) {
        ensureOk(
          await db.update(
            SESSIONS_TABLE2,
            { revoked_at: nowIso },
            [
              ["token_hash", "eq", tokenHash],
              ["revoked_at", "is", null]
            ]
          )
        );
        try {
          await db.insert(AUDIT_TABLE, {
            actor_id: session.employee_id,
            action: "logout",
            entity: "auth_session",
            entity_id: session.id,
            detail: null
          });
        } catch {
        }
      }
    }
    c.header("Set-Cookie", clearSessionCookie(env));
    return c.json({ ok: true }, 200);
  } catch (error) {
    logFailure("auth logout failed", error);
    c.header("Set-Cookie", clearSessionCookie(env));
    return c.json({ ok: false, message: LOGOUT_FAILED_MESSAGE }, 500);
  }
});
auth.post("/set-pin", async (c) => {
  try {
    const body = await readJson(c);
    if (!hasExactStringKeys(body, ["nationalId", "code", "pin", "pinConfirm"])) {
      return c.json({ ok: false, message: INVALID_MESSAGE }, 400);
    }
    const normalized = normalizeNationalId(body.nationalId);
    if (!/^\d{13}$/.test(normalized) || !/^\d{8}$/.test(body.code)) {
      return c.json({ ok: false, message: INVALID_MESSAGE }, 400);
    }
    const validation = validatePin(body.pin);
    if (!validation.ok) {
      return c.json({ ok: false, message: validation.message }, 400);
    }
    if (body.pinConfirm !== body.pin) {
      return c.json({ ok: false, message: PIN_CONFIRM_MESSAGE }, 400);
    }
    const env = c.env;
    const db = createDb(env);
    const now = /* @__PURE__ */ new Date();
    const nowIso = now.toISOString();
    const nationalHash = await nationalIdHash(
      normalized,
      getRequiredEnv(env, "NATIONAL_ID_PEPPER")
    );
    const credential = await db.select(CREDENTIALS_TABLE, {
      columns: "*",
      filters: [["national_id_hash", "eq", nationalHash]],
      single: true
    });
    const employee = credential ? await db.select("employees", {
      columns: "id,is_active",
      filters: [["id", "eq", credential.employee_id]],
      single: true
    }) : null;
    if (!credential || !employee || employee.is_active !== true) {
      return c.json({ ok: false, message: SET_PIN_INVALID_MESSAGE }, 401);
    }
    const resetCode = await db.select(RESET_CODES_TABLE, {
      columns: "*",
      filters: [
        ["employee_id", "eq", employee.id],
        ["used_at", "is", null],
        ["expires_at", "gt", nowIso],
        ["attempts", "lt", RESET_CODE_MAX_ATTEMPTS]
      ],
      order: "created_at.desc",
      single: true
    });
    if (!resetCode) {
      return c.json({ ok: false, message: SET_PIN_INVALID_MESSAGE }, 401);
    }
    const expected = await hmacSha256Hex(
      getRequiredEnv(env, "PIN_RESET_SECRET"),
      `${employee.id}:${body.code}`
    );
    if (!timingSafeEqualHex(expected, resetCode.code_hash)) {
      const attempts = failedAttempts(resetCode.attempts) + 1;
      const patch = { attempts };
      if (attempts >= RESET_CODE_MAX_ATTEMPTS) patch.used_at = nowIso;
      ensureOk(
        await db.update(RESET_CODES_TABLE, patch, [["id", "eq", resetCode.id]])
      );
      return c.json({ ok: false, message: SET_PIN_INVALID_MESSAGE }, 401);
    }
    const newPinHash = await pinHash(
      getRequiredEnv(env, "PIN_PEPPER"),
      employee.id,
      body.pin
    );
    ensureOk(
      await db.update(
        CREDENTIALS_TABLE,
        {
          pin_hash: newPinHash,
          pin_set_at: nowIso,
          failed_attempts: 0,
          locked_until: null,
          updated_at: nowIso
        },
        [["employee_id", "eq", employee.id]]
      )
    );
    ensureOk(
      await db.update(RESET_CODES_TABLE, { used_at: nowIso }, [
        ["id", "eq", resetCode.id]
      ])
    );
    ensureOk(
      await db.update(
        SESSIONS_TABLE2,
        { revoked_at: nowIso },
        [
          ["employee_id", "eq", employee.id],
          ["revoked_at", "is", null]
        ]
      )
    );
    ensureOk(
      await db.insert(AUDIT_TABLE, {
        actor_id: employee.id,
        action: "pin_set",
        entity: "employee",
        entity_id: employee.id,
        detail: null
      })
    );
    return c.json({ ok: true }, 200);
  } catch (error) {
    logFailure("auth set-pin failed", error);
    return c.json({ ok: false, message: SET_PIN_FAILED_MESSAGE }, 500);
  }
});
var auth_default = auth;

// src/register-window.js
var BANGKOK_TIME_ZONE = "Asia/Bangkok";
var BEFORE_MESSAGE = "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E16\u0E36\u0E07\u0E40\u0E27\u0E25\u0E32\u0E25\u0E07\u0E17\u0E30\u0E40\u0E1A\u0E35\u0E22\u0E19\u0E40\u0E02\u0E49\u0E32\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21";
var AFTER_MESSAGE = "\u0E2B\u0E21\u0E14\u0E40\u0E27\u0E25\u0E32\u0E01\u0E32\u0E23\u0E25\u0E07\u0E17\u0E30\u0E40\u0E1A\u0E35\u0E22\u0E19\u0E40\u0E02\u0E49\u0E32\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21\u0E41\u0E25\u0E49\u0E27";
var NO_SESSION_MESSAGE = "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E01\u0E33\u0E2B\u0E19\u0E14\u0E23\u0E2D\u0E1A\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E41\u0E08\u0E49\u0E07\u0E1C\u0E39\u0E49\u0E14\u0E39\u0E41\u0E25";
function bangkokToday(now = /* @__PURE__ */ new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BANGKOK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}
__name(bangkokToday, "bangkokToday");
function bangkokMoment(now) {
  const date = bangkokToday(now);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: BANGKOK_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(now);
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { date, time, weekday };
}
__name(bangkokMoment, "bangkokMoment");
function normalizeTime(value) {
  if (typeof value !== "string" || value.length < 5) return null;
  return value.slice(0, 5);
}
__name(normalizeTime, "normalizeTime");
function noSession() {
  return { state: "no_session", message: NO_SESSION_MESSAGE };
}
__name(noSession, "noSession");
function evaluate(nowTime, session) {
  if (nowTime < session.openTime) {
    return {
      state: "before",
      openTime: session.openTime,
      cutoffTime: session.cutoffTime,
      message: BEFORE_MESSAGE
    };
  }
  if (nowTime >= session.cutoffTime) {
    return { state: "after", message: AFTER_MESSAGE };
  }
  return { state: "open", session };
}
__name(evaluate, "evaluate");
function resolveScanState({ now, typeCode, meetingDefaults, sessions }) {
  const current = bangkokMoment(now);
  if (typeCode === "sup") {
    if (current.weekday !== meetingDefaults?.weekday) return noSession();
    const openTime = normalizeTime(meetingDefaults?.openTime);
    const cutoffTime = normalizeTime(meetingDefaults?.cutoffTime);
    if (!openTime || !cutoffTime) return noSession();
    return evaluate(current.time, { sessionDate: current.date, openTime, cutoffTime });
  }
  if (typeCode === "monthly") {
    const session = (sessions ?? []).find((item) => item.sessionDate === current.date);
    if (!session) return noSession();
    const openTime = normalizeTime(session.openTime);
    const cutoffTime = normalizeTime(session.cutoffTime);
    if (!openTime || !cutoffTime) return noSession();
    return evaluate(current.time, {
      sessionDate: session.sessionDate,
      openTime,
      cutoffTime
    });
  }
  return noSession();
}
__name(resolveScanState, "resolveScanState");

// src/attendance-status.js
var STATUS_CODE_BY_LABEL = {
  \u0E40\u0E02\u0E49\u0E32\u0E23\u0E48\u0E27\u0E21\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21: "attended",
  \u0E44\u0E21\u0E48\u0E40\u0E02\u0E49\u0E32\u0E23\u0E48\u0E27\u0E21: "not_attended",
  \u0E15\u0E34\u0E14\u0E07\u0E32\u0E19\u0E14\u0E48\u0E27\u0E19: "urgent_busy",
  \u0E25\u0E32\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21: "leave"
};
function statusCodeFromLabel(label) {
  if (typeof label !== "string") return null;
  return STATUS_CODE_BY_LABEL[label] ?? null;
}
__name(statusCodeFromLabel, "statusCodeFromLabel");

// src/rate-limit.js
var RATE_LIMIT_MESSAGE = "\u0E2A\u0E48\u0E07\u0E04\u0E33\u0E02\u0E2D\u0E1A\u0E48\u0E2D\u0E22\u0E40\u0E01\u0E34\u0E19\u0E44\u0E1B \u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E2D\u0E2A\u0E31\u0E01\u0E04\u0E23\u0E39\u0E48\u0E41\u0E25\u0E49\u0E27\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48";
var SERVICE_UNAVAILABLE_MESSAGE = "\u0E23\u0E30\u0E1A\u0E1A\u0E02\u0E31\u0E14\u0E02\u0E49\u0E2D\u0E07\u0E0A\u0E31\u0E48\u0E27\u0E04\u0E23\u0E32\u0E27 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07";
var CHECK_URL = "https://rate-limit.internal/check";
function clientIp(request) {
  const value = request?.headers?.get?.("CF-Connecting-IP");
  return typeof value === "string" && value.length > 0 ? value : "unknown";
}
__name(clientIp, "clientIp");
function ipRateLimitKey(scope, ip) {
  return `${scope}|${ip}`;
}
__name(ipRateLimitKey, "ipRateLimitKey");
async function tokenRateLimitKey(token) {
  return `submit|${await sha256Hex(token)}`;
}
__name(tokenRateLimitKey, "tokenRateLimitKey");
function unavailable() {
  return { ok: false, status: 503, message: SERVICE_UNAVAILABLE_MESSAGE };
}
__name(unavailable, "unavailable");
async function checkRateLimit(env, bindingName, key) {
  const namespace = env ? env[bindingName] : null;
  if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") {
    return unavailable();
  }
  try {
    const stub = namespace.get(namespace.idFromName(key));
    if (!stub || typeof stub.fetch !== "function") return unavailable();
    const response = await stub.fetch(CHECK_URL, { method: "POST" });
    if (!response.ok) return unavailable();
    const result = await response.json().catch(() => null);
    if (!result || typeof result.success !== "boolean") return unavailable();
    if (result.success) return { ok: true };
    return { ok: false, status: 429, message: RATE_LIMIT_MESSAGE };
  } catch {
    return unavailable();
  }
}
__name(checkRateLimit, "checkRateLimit");

// src/turnstile.js
var SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
var VERIFY_TIMEOUT_MS = 5e3;
function turnstileEnabled(env) {
  return env?.TURNSTILE_ENABLED === "true";
}
__name(turnstileEnabled, "turnstileEnabled");
async function verifyTurnstile(token, ip, secret) {
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (typeof ip === "string" && ip.length > 0) body.set("remoteip", ip);
  const response = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error("turnstile verification failed");
  let result = null;
  try {
    result = await response.json();
  } catch {
    throw new Error("turnstile verification failed");
  }
  return { ok: result?.success === true };
}
__name(verifyTurnstile, "verifyTurnstile");

// src/routes/register.js
var register = new Hono3();
var LINK_ERROR_MESSAGE = "\u0E25\u0E34\u0E07\u0E01\u0E4C\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E2A\u0E41\u0E01\u0E19 QR \u0E43\u0E2B\u0E21\u0E48\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07";
var SERVER_ERROR_MESSAGE = "\u0E23\u0E30\u0E1A\u0E1A\u0E02\u0E31\u0E14\u0E02\u0E49\u0E2D\u0E07\u0E0A\u0E31\u0E48\u0E27\u0E04\u0E23\u0E32\u0E27 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07";
var ROSTER_ERROR_MESSAGE = "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E23\u0E32\u0E22\u0E0A\u0E37\u0E48\u0E2D\u0E19\u0E35\u0E49\u0E43\u0E19\u0E23\u0E32\u0E22\u0E0A\u0E37\u0E48\u0E2D\u0E01\u0E32\u0E23\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21";
var DUPLICATE_MESSAGE = "\u0E17\u0E48\u0E32\u0E19\u0E44\u0E14\u0E49\u0E25\u0E07\u0E17\u0E30\u0E40\u0E1A\u0E35\u0E22\u0E19\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21\u0E19\u0E35\u0E49\u0E41\u0E25\u0E49\u0E27";
var INVALID_BODY_MESSAGE = "\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07";
var TURNSTILE_ERROR_MESSAGE = "\u0E22\u0E37\u0E19\u0E22\u0E31\u0E19\u0E15\u0E31\u0E27\u0E15\u0E19\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48";
var DASH = "-";
var TOKEN_PATTERN = /^[0-9a-f]{64}$/;
var MAX_BODY_BYTES = 4 * 1024;
var REASON_MAX_LENGTH = 200;
var STATUSES = Object.keys(STATUS_CODE_BY_LABEL);
var REASON_STATUSES = ["\u0E15\u0E34\u0E14\u0E07\u0E32\u0E19\u0E14\u0E48\u0E27\u0E19", "\u0E25\u0E32\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21"];
var LEAVE_STATUS = "\u0E25\u0E32\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21";
var SHIFTS = ["\u0E01\u0E30 A", "\u0E01\u0E30 B"];
var RATE_LIMIT_CONTEXT_BINDING = "RL_CONTEXT_IP";
var RATE_LIMIT_SUBMIT_IP_BINDING = "RL_SUBMIT_IP";
var RATE_LIMIT_SUBMIT_TOKEN_BINDING = "RL_SUBMIT_TOKEN";
var UUID_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
var SESSIONS_TABLE3 = "meeting_sessions";
var ATTENDANCE_TABLE = "meeting_attendance";
var ROSTER_TABLE = "meeting_roster";
register.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
__name(isPlainObject2, "isPlainObject");
function isJsonContentType(value) {
  if (typeof value !== "string") return false;
  const mediaType = value.split(";")[0].trim().toLowerCase();
  return mediaType === "application/json";
}
__name(isJsonContentType, "isJsonContentType");
function logError(scope, error) {
  console.error(scope, {
    name: error?.name,
    code: error?.code,
    constraint: error?.constraint
  });
}
__name(logError, "logError");
function toHm(value) {
  if (typeof value !== "string" || value.length < 5) return null;
  return value.slice(0, 5);
}
__name(toHm, "toHm");
function formatSavedAt(date) {
  const day = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
  return `${day} \xB7 ${time} \u0E19.`;
}
__name(formatSavedAt, "formatSavedAt");
function firstEmbedded(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
__name(firstEmbedded, "firstEmbedded");
async function findTypeByToken(db, token) {
  if (typeof token !== "string" || token.length === 0) return null;
  return db.select("meeting_types", {
    columns: "id,code,name,weekday,default_open_time,default_cutoff_time",
    filters: [["qr_token", "eq", token]],
    single: true
  });
}
__name(findTypeByToken, "findTypeByToken");
async function loadMonthlySessions(db, typeId) {
  const today = bangkokToday();
  const rows = await db.select(SESSIONS_TABLE3, {
    columns: "id,session_date,open_time,cutoff_time",
    filters: [
      ["meeting_type_id", "eq", typeId],
      ["session_date", "eq", today]
    ]
  });
  return rows.map((row) => ({
    id: row.id,
    sessionDate: row.session_date,
    openTime: toHm(row.open_time),
    cutoffTime: toHm(row.cutoff_time)
  }));
}
__name(loadMonthlySessions, "loadMonthlySessions");
async function resolveForType(db, type) {
  const sessions = type.code === "monthly" ? await loadMonthlySessions(db, type.id) : [];
  const state = resolveScanState({
    now: /* @__PURE__ */ new Date(),
    typeCode: type.code,
    meetingDefaults: {
      weekday: type.weekday,
      openTime: toHm(type.default_open_time),
      cutoffTime: toHm(type.default_cutoff_time)
    },
    sessions
  });
  return { state, sessions };
}
__name(resolveForType, "resolveForType");
async function loadActiveEmployees(db, typeId) {
  const rows = await db.select(ROSTER_TABLE, {
    columns: "employee_id,employees!meeting_roster_employee_id_fkey!inner(full_name,departments(name),positions(name))",
    filters: [
      ["meeting_type_id", "eq", typeId],
      ["is_active", "eq", true]
    ]
  });
  return rows.map((row) => {
    const employee = firstEmbedded(row.employees);
    return {
      employeeId: row.employee_id,
      fullName: employee?.full_name ?? DASH,
      departmentName: firstEmbedded(employee?.departments)?.name ?? DASH,
      positionName: firstEmbedded(employee?.positions)?.name ?? DASH
    };
  }).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), "th"));
}
__name(loadActiveEmployees, "loadActiveEmployees");
async function findSessionForDay(db, typeId, sessionDate) {
  return db.select(SESSIONS_TABLE3, {
    columns: "id",
    filters: [
      ["meeting_type_id", "eq", typeId],
      ["session_date", "eq", sessionDate]
    ],
    single: true
  });
}
__name(findSessionForDay, "findSessionForDay");
async function ensureSession(db, type, sessions, state) {
  if (type.code === "sup") {
    const today = bangkokToday();
    const existing = await findSessionForDay(db, type.id, today);
    if (existing) return existing;
    const { data: created, error } = await db.insert(
      SESSIONS_TABLE3,
      {
        meeting_type_id: type.id,
        session_date: today,
        cycle_key: `sup-${today}`,
        open_time: toHm(type.default_open_time),
        cutoff_time: toHm(type.default_cutoff_time)
      },
      { returning: true }
    );
    if (error) {
      if (error.code !== "23505") throw error;
      const raced = await findSessionForDay(db, type.id, today);
      if (raced) return raced;
      throw error;
    }
    if (!created || !created.id) throw new Error("session insert returned no row");
    return created;
  }
  const session = (sessions ?? []).find(
    (row) => row.sessionDate === state.session?.sessionDate
  );
  return session ? { id: session.id } : null;
}
__name(ensureSession, "ensureSession");
async function readStrictJson(c) {
  if (!isJsonContentType(c.req.header("Content-Type"))) return null;
  const declaredLength = Number(c.req.header("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null;
  let text;
  try {
    text = await c.req.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(text);
    return isPlainObject2(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
__name(readStrictJson, "readStrictJson");
function invalidBody(c) {
  return c.json({ ok: false, message: INVALID_BODY_MESSAGE }, 400);
}
__name(invalidBody, "invalidBody");
async function enforceLimit(c, bindingName, key) {
  const result = await checkRateLimit(c.env, bindingName, key);
  if (result.ok) return null;
  return c.json({ ok: false, message: result.message }, result.status);
}
__name(enforceLimit, "enforceLimit");
register.get("/context", async (c) => {
  const token = c.req.query("t");
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    return c.json({ ok: false, message: LINK_ERROR_MESSAGE }, 404);
  }
  const limited = await enforceLimit(
    c,
    RATE_LIMIT_CONTEXT_BINDING,
    ipRateLimitKey("context", clientIp(c.req.raw))
  );
  if (limited) return limited;
  try {
    const db = createDb(c.env);
    const type = await findTypeByToken(db, token);
    if (!type) return c.json({ ok: false, message: LINK_ERROR_MESSAGE }, 404);
    const { state } = await resolveForType(db, type);
    const payload = {
      ok: true,
      meetingName: type.name,
      state: state.state,
      statuses: STATUSES,
      shifts: SHIFTS,
      reasonStatuses: REASON_STATUSES,
      leaveStatus: LEAVE_STATUS
    };
    if (state.message) payload.message = state.message;
    if (state.state === "before") {
      payload.openTime = state.openTime;
      payload.cutoffTime = state.cutoffTime;
    }
    if (state.state === "open") {
      payload.openTime = state.session.openTime;
      payload.cutoffTime = state.session.cutoffTime;
      payload.employees = await loadActiveEmployees(db, type.id);
    }
    return c.json(payload, 200);
  } catch (error) {
    logError("register context failed", error);
    return c.json({ ok: false, message: SERVER_ERROR_MESSAGE }, 500);
  }
});
register.post("/submit", async (c) => {
  const body = await readStrictJson(c);
  if (!body) return invalidBody(c);
  if (typeof body.t !== "string" || !TOKEN_PATTERN.test(body.t)) {
    return c.json({ ok: false, message: LINK_ERROR_MESSAGE }, 404);
  }
  const verifyingTurnstile = turnstileEnabled(c.env);
  const allowedKeys = ["t", "employeeId", "statusCode", "shift", "reason"];
  if (verifyingTurnstile) allowedKeys.push("turnstileToken");
  const hasRequiredKeys = ["t", "employeeId", "statusCode"].every(
    (key) => Object.prototype.hasOwnProperty.call(body, key)
  );
  const extraKey = Object.keys(body).some((key) => !allowedKeys.includes(key));
  if (!hasRequiredKeys || extraKey) return invalidBody(c);
  const shiftValue = body.shift === void 0 || body.shift === null ? null : body.shift;
  const reasonValue = body.reason === void 0 || body.reason === null ? null : body.reason;
  const shapeOk = typeof body.employeeId === "string" && UUID_PATTERN.test(body.employeeId) && typeof body.statusCode === "string" && (body.shift === void 0 || body.shift === null || typeof body.shift === "string") && (body.reason === void 0 || body.reason === null || typeof body.reason === "string");
  if (!shapeOk) return invalidBody(c);
  const statusDbCode = statusCodeFromLabel(body.statusCode);
  if (statusDbCode === null) return invalidBody(c);
  const status = body.statusCode;
  if (status === LEAVE_STATUS) {
    if (!SHIFTS.includes(shiftValue)) return invalidBody(c);
  } else if (shiftValue !== null) {
    return invalidBody(c);
  }
  const needsReason = REASON_STATUSES.includes(status);
  const trimmedReason = typeof reasonValue === "string" ? reasonValue.trim() : "";
  if (needsReason) {
    if (trimmedReason.length === 0 || trimmedReason.length > REASON_MAX_LENGTH) {
      return invalidBody(c);
    }
  } else if (trimmedReason.length > 0) {
    return invalidBody(c);
  }
  const savedReason = needsReason ? trimmedReason : null;
  const savedShift = status === LEAVE_STATUS ? shiftValue : null;
  if (verifyingTurnstile) {
    if (typeof body.turnstileToken !== "string" || body.turnstileToken.length === 0) {
      return c.json({ ok: false, message: TURNSTILE_ERROR_MESSAGE }, 403);
    }
  }
  const ip = clientIp(c.req.raw);
  const ipLimited = await enforceLimit(
    c,
    RATE_LIMIT_SUBMIT_IP_BINDING,
    ipRateLimitKey("submit", ip)
  );
  if (ipLimited) return ipLimited;
  const tokenLimited = await enforceLimit(
    c,
    RATE_LIMIT_SUBMIT_TOKEN_BINDING,
    await tokenRateLimitKey(body.t)
  );
  if (tokenLimited) return tokenLimited;
  if (verifyingTurnstile) {
    try {
      const secret = c.env.TURNSTILE_SECRET_KEY;
      if (typeof secret !== "string" || secret.length === 0) {
        return c.json({ ok: false, message: SERVER_ERROR_MESSAGE }, 503);
      }
      const verdict = await verifyTurnstile(body.turnstileToken, ip, secret);
      if (!verdict.ok) {
        return c.json({ ok: false, message: TURNSTILE_ERROR_MESSAGE }, 403);
      }
    } catch {
      return c.json({ ok: false, message: SERVER_ERROR_MESSAGE }, 503);
    }
  }
  try {
    const db = createDb(c.env);
    const type = await findTypeByToken(db, body.t);
    if (!type) return c.json({ ok: false, message: LINK_ERROR_MESSAGE }, 404);
    const { state, sessions } = await resolveForType(db, type);
    if (state.state !== "open") {
      return c.json({ ok: false, message: state.message }, 403);
    }
    const rosterRow = await db.select(ROSTER_TABLE, {
      columns: "employee_id",
      filters: [
        ["meeting_type_id", "eq", type.id],
        ["employee_id", "eq", body.employeeId],
        ["is_active", "eq", true]
      ],
      single: true
    });
    if (!rosterRow) return c.json({ ok: false, message: ROSTER_ERROR_MESSAGE }, 400);
    const employee = await db.select("employees", {
      columns: "id,full_name,department_id,position_id,departments(name),positions(name)",
      filters: [["id", "eq", body.employeeId]],
      single: true
    });
    if (!employee) return c.json({ ok: false, message: ROSTER_ERROR_MESSAGE }, 400);
    const session = await ensureSession(db, type, sessions, state);
    if (!session) return c.json({ ok: false, message: SERVER_ERROR_MESSAGE }, 500);
    const existing = await db.select(ATTENDANCE_TABLE, {
      columns: "id",
      filters: [
        ["session_id", "eq", session.id],
        ["employee_id", "eq", body.employeeId]
      ],
      single: true
    });
    if (existing) return c.json({ ok: false, message: DUPLICATE_MESSAGE }, 409);
    const now = /* @__PURE__ */ new Date();
    const { error: insertError } = await db.insert(ATTENDANCE_TABLE, {
      session_id: session.id,
      employee_id: body.employeeId,
      status_code: statusDbCode,
      reason: savedReason,
      shift: savedShift,
      department_id: employee.department_id ?? null,
      position_id: employee.position_id ?? null,
      registered_at: now.toISOString()
    });
    if (insertError) {
      if (insertError.code === "23505") {
        return c.json({ ok: false, message: DUPLICATE_MESSAGE }, 409);
      }
      throw insertError;
    }
    return c.json(
      {
        ok: true,
        summary: {
          name: employee.full_name ?? DASH,
          dept: firstEmbedded(employee.departments)?.name ?? DASH,
          level: firstEmbedded(employee.positions)?.name ?? DASH,
          status,
          shift: savedShift,
          meetingName: type.name,
          savedAt: formatSavedAt(now)
        }
      },
      200
    );
  } catch (error) {
    logError("register submit failed", error);
    return c.json({ ok: false, message: SERVER_ERROR_MESSAGE }, 500);
  }
});
var register_default = register;

// src/require-role.js
var MESSAGE_UNAUTHENTICATED = "\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E39\u0E48\u0E23\u0E30\u0E1A\u0E1A";
var MESSAGE_FORBIDDEN = "\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C\u0E40\u0E02\u0E49\u0E32\u0E16\u0E36\u0E07\u0E2A\u0E48\u0E27\u0E19\u0E19\u0E35\u0E49";
async function requireRole(env, request, roles) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const session = await readSession(env, cookies[sessionCookieName]);
  if (!session.ok) {
    return { status: 401, message: MESSAGE_UNAUTHENTICATED };
  }
  const allowedRoles = Array.isArray(roles) ? roles : [];
  if (!allowedRoles.includes(session.role)) {
    return { status: 403, message: MESSAGE_FORBIDDEN };
  }
  return { ok: true, session };
}
__name(requireRole, "requireRole");

// src/meeting-window.js
var TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
var TIME_FORMAT_MESSAGE = "\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A\u0E40\u0E27\u0E25\u0E32\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07";
var TIME_ORDER_MESSAGE = "\u0E40\u0E27\u0E25\u0E32\u0E40\u0E1B\u0E34\u0E14\u0E23\u0E31\u0E1A\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E48\u0E2D\u0E19\u0E40\u0E27\u0E25\u0E32\u0E1B\u0E34\u0E14\u0E23\u0E31\u0E1A";
function validateWindow({ openTime, cutoffTime }) {
  if (!TIME_PATTERN.test(openTime) || !TIME_PATTERN.test(cutoffTime)) {
    return { ok: false, message: TIME_FORMAT_MESSAGE };
  }
  if (openTime >= cutoffTime) {
    return { ok: false, message: TIME_ORDER_MESSAGE };
  }
  return { ok: true };
}
__name(validateWindow, "validateWindow");
function buildRegisterUrl(origin, token) {
  if (typeof origin !== "string" || origin.trim().length === 0) {
    throw new Error("origin is required");
  }
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("token is required");
  }
  const base = origin.trim().replace(/\/+$/, "");
  return `${base}/meeting/register?t=${encodeURIComponent(token)}`;
}
__name(buildRegisterUrl, "buildRegisterUrl");
function newQrToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
__name(newQrToken, "newQrToken");

// src/routes/meeting.js
var meeting = new Hono3();
var SAVE_ERROR_MESSAGE = "\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E44\u0E14\u0E49 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48";
var INVALID_BODY_MESSAGE2 = "\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07";
var SUP_ONLY_MESSAGE = "\u0E41\u0E01\u0E49\u0E44\u0E02\u0E44\u0E14\u0E49\u0E40\u0E09\u0E1E\u0E32\u0E30\u0E01\u0E32\u0E23\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21\u0E2B\u0E31\u0E27\u0E2B\u0E19\u0E49\u0E32\u0E07\u0E32\u0E19";
var NOT_FOUND_MESSAGE = "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17\u0E01\u0E32\u0E23\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21";
var TYPES_TABLE = "meeting_types";
var AUDIT_TABLE2 = "audit_logs";
var MAX_BODY_BYTES2 = 4 * 1024;
var ROLE = "meeting_controller";
meeting.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});
function isPlainObject3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
__name(isPlainObject3, "isPlainObject");
function isJsonContentType2(value) {
  if (typeof value !== "string") return false;
  return value.split(";")[0].trim().toLowerCase() === "application/json";
}
__name(isJsonContentType2, "isJsonContentType");
async function readStrictJson2(c) {
  if (!isJsonContentType2(c.req.header("Content-Type"))) return null;
  const declaredLength = Number(c.req.header("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES2) return null;
  let text;
  try {
    text = await c.req.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES2) return null;
  try {
    const parsed = JSON.parse(text);
    return isPlainObject3(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
__name(readStrictJson2, "readStrictJson");
function invalidBody2(c) {
  return c.json({ ok: false, message: INVALID_BODY_MESSAGE2 }, 400);
}
__name(invalidBody2, "invalidBody");
function isStrictBody(value, keys) {
  if (!isPlainObject3(value)) return false;
  if (Object.keys(value).length !== keys.length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
__name(isStrictBody, "isStrictBody");
function logError2(scope, error) {
  console.error(scope, { name: error?.name, code: error?.code });
}
__name(logError2, "logError");
function toHm2(value) {
  if (typeof value !== "string" || value.length < 5) return null;
  return value.slice(0, 5);
}
__name(toHm2, "toHm");
function ensureOk2(result) {
  if (result && result.error) {
    const error = new Error("database write failed");
    error.code = result.error.code;
    throw error;
  }
  return result;
}
__name(ensureOk2, "ensureOk");
async function guard(c) {
  const auth2 = await requireRole(c.env, c.req.raw, [ROLE]);
  if (auth2.status) {
    return c.json({ ok: false, message: auth2.message }, auth2.status);
  }
  c.set("meetingSession", auth2.session);
  return null;
}
__name(guard, "guard");
function authSession(c) {
  return c.get("meetingSession");
}
__name(authSession, "authSession");
meeting.get("/types", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;
  try {
    const origin = getRequiredEnv(c.env, "APP_ORIGIN");
    const db = createDb(c.env);
    const types = await db.select(TYPES_TABLE, {
      columns: "code,name,qr_token,weekday,default_open_time,default_cutoff_time",
      order: "code.asc"
    });
    const rows = types.map((type) => ({
      code: type.code,
      name: type.name,
      registerUrl: buildRegisterUrl(origin, type.qr_token),
      weekday: type.weekday === null || type.weekday === void 0 ? null : type.weekday,
      openTime: toHm2(type.default_open_time),
      cutoffTime: toHm2(type.default_cutoff_time)
    }));
    return c.json({ ok: true, types: rows }, 200);
  } catch (error) {
    logError2("meeting types failed", error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
  }
});
meeting.post("/qr/rotate", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;
  const body = await readStrictJson2(c);
  if (!isStrictBody(body, ["code"])) return invalidBody2(c);
  if (body.code !== "sup" && body.code !== "monthly") return invalidBody2(c);
  try {
    const origin = getRequiredEnv(c.env, "APP_ORIGIN");
    const token = newQrToken();
    const db = createDb(c.env);
    const type = await db.select(TYPES_TABLE, {
      columns: "id",
      filters: [["code", "eq", body.code]],
      single: true
    });
    if (!type) return c.json({ ok: false, message: NOT_FOUND_MESSAGE }, 400);
    ensureOk2(
      await db.update(TYPES_TABLE, { qr_token: token }, [["code", "eq", body.code]])
    );
    ensureOk2(
      await db.insert(AUDIT_TABLE2, {
        actor_id: authSession(c).employeeId,
        action: "meeting_qr_rotated",
        entity: "meeting_type",
        entity_id: type.id,
        detail: null
      })
    );
    return c.json({ ok: true, registerUrl: buildRegisterUrl(origin, token) }, 200);
  } catch (error) {
    logError2("meeting qr rotate failed", error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
  }
});
meeting.put("/window", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;
  const body = await readStrictJson2(c);
  if (!isPlainObject3(body)) return invalidBody2(c);
  const allowedKeys = ["openTime", "cutoffTime", "code"];
  const hasRequiredKeys = typeof body.openTime === "string" && Object.prototype.hasOwnProperty.call(body, "openTime") && typeof body.cutoffTime === "string" && Object.prototype.hasOwnProperty.call(body, "cutoffTime");
  const codePresent = Object.prototype.hasOwnProperty.call(body, "code");
  const extraKey = Object.keys(body).some((key) => !allowedKeys.includes(key));
  if (!hasRequiredKeys || extraKey) return invalidBody2(c);
  if (codePresent && (typeof body.code !== "string" || body.code !== "sup")) {
    return c.json({ ok: false, message: SUP_ONLY_MESSAGE }, 400);
  }
  const { openTime, cutoffTime } = body;
  const validation = validateWindow({ openTime, cutoffTime });
  if (!validation.ok) return c.json({ ok: false, message: validation.message }, 400);
  try {
    const db = createDb(c.env);
    const current = await db.select(TYPES_TABLE, {
      columns: "id,default_open_time,default_cutoff_time",
      filters: [["code", "eq", "sup"]],
      single: true
    });
    if (!current) return c.json({ ok: false, message: NOT_FOUND_MESSAGE }, 400);
    ensureOk2(
      await db.update(
        TYPES_TABLE,
        { default_open_time: openTime, default_cutoff_time: cutoffTime },
        [["id", "eq", current.id]]
      )
    );
    ensureOk2(
      await db.insert(AUDIT_TABLE2, {
        actor_id: authSession(c).employeeId,
        action: "meeting_window_updated",
        entity: "meeting_type",
        entity_id: current.id,
        detail: JSON.stringify({
          old: {
            openTime: toHm2(current.default_open_time),
            cutoffTime: toHm2(current.default_cutoff_time)
          },
          new: { openTime, cutoffTime }
        })
      })
    );
    return c.json({ ok: true }, 200);
  } catch (error) {
    logError2("meeting window failed", error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
  }
});
var meeting_default = meeting;

// src/meeting-roster.js
function normalizeSearchQuery(q) {
  if (typeof q !== "string") return "";
  return q.trim().replace(/\s+/g, " ");
}
__name(normalizeSearchQuery, "normalizeSearchQuery");
function isValidSearchQuery(q) {
  return normalizeSearchQuery(q).length >= 2;
}
__name(isValidSearchQuery, "isValidSearchQuery");
function escapeIlike(value) {
  return value.replace(/[\\%_]/g, (match2) => "\\" + match2);
}
__name(escapeIlike, "escapeIlike");
function sortThai(list) {
  return [...list].sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), "th"));
}
__name(sortThai, "sortThai");

// src/routes/meeting-roster.js
var roster = new Hono3();
var SAVE_ERROR_MESSAGE2 = "\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E44\u0E14\u0E49 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48";
var TYPE_ERROR_MESSAGE = "\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17\u0E01\u0E32\u0E23\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07";
var EMPLOYEE_ERROR_MESSAGE = "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E1E\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19\u0E17\u0E35\u0E48\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E2D\u0E22\u0E39\u0E48";
var ROSTER_MESSAGE = "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E23\u0E32\u0E22\u0E0A\u0E37\u0E48\u0E2D\u0E19\u0E35\u0E49";
var INVALID_BODY_MESSAGE3 = "\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07";
var TYPES_TABLE2 = "meeting_types";
var ROSTER_TABLE2 = "meeting_roster";
var EMPLOYEES_TABLE = "employees";
var SHARED_CODE = "sup";
var MONTHLY_CODE = "monthly";
var ROLE2 = "meeting_controller";
var SEARCH_LIMIT = 10;
var ROSTER_CONFLICT = "meeting_type_id,employee_id";
var MAX_BODY_BYTES3 = 4 * 1024;
var MEMBER_FIELDS = "employee_id,employees!meeting_roster_employee_id_fkey!inner(employee_code,full_name,departments(name),positions(name))";
var EMPLOYEE_FIELDS = "id,employee_code,full_name,departments(name),positions(name)";
var UUID_PATTERN2 = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
var DASH2 = "-";
roster.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});
function isPlainObject4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
__name(isPlainObject4, "isPlainObject");
function isJsonContentType3(value) {
  if (typeof value !== "string") return false;
  return value.split(";")[0].trim().toLowerCase() === "application/json";
}
__name(isJsonContentType3, "isJsonContentType");
async function readStrictJson3(c) {
  if (!isJsonContentType3(c.req.header("Content-Type"))) return null;
  const declaredLength = Number(c.req.header("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES3) return null;
  let text;
  try {
    text = await c.req.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES3) return null;
  try {
    const parsed = JSON.parse(text);
    return isPlainObject4(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
__name(readStrictJson3, "readStrictJson");
function invalidBody3(c) {
  return c.json({ ok: false, message: INVALID_BODY_MESSAGE3 }, 400);
}
__name(invalidBody3, "invalidBody");
function isStrictEmployeeBody(value) {
  return isPlainObject4(value) && Object.keys(value).length === 1 && Object.prototype.hasOwnProperty.call(value, "employeeId") && typeof value.employeeId === "string" && UUID_PATTERN2.test(value.employeeId);
}
__name(isStrictEmployeeBody, "isStrictEmployeeBody");
function logError3(error) {
  console.error("meeting roster failed", { name: error?.name, code: error?.code });
}
__name(logError3, "logError");
function ensureOk3(result) {
  if (result && result.error) {
    const error = new Error("database write failed");
    error.code = result.error.code;
    throw error;
  }
  return result;
}
__name(ensureOk3, "ensureOk");
async function guard2(c) {
  const auth2 = await requireRole(c.env, c.req.raw, [ROLE2]);
  if (auth2.status) {
    return c.json({ ok: false, message: auth2.message }, auth2.status);
  }
  c.set("meetingSession", auth2.session);
  return null;
}
__name(guard2, "guard");
function authSession2(c) {
  return c.get("meetingSession");
}
__name(authSession2, "authSession");
async function findTypeIds(db) {
  const [sup, monthly] = await Promise.all([
    db.select(TYPES_TABLE2, {
      columns: "id,code",
      filters: [["code", "eq", SHARED_CODE]],
      single: true
    }),
    db.select(TYPES_TABLE2, {
      columns: "id,code",
      filters: [["code", "eq", MONTHLY_CODE]],
      single: true
    })
  ]);
  return { supId: sup ? sup.id : null, monthlyId: monthly ? monthly.id : null };
}
__name(findTypeIds, "findTypeIds");
function firstEmbedded2(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
__name(firstEmbedded2, "firstEmbedded");
function toMember(row) {
  const employee = row.employees ?? {};
  return {
    employeeId: row.employee_id,
    employeeCode: employee.employee_code ?? DASH2,
    fullName: employee.full_name ?? DASH2,
    departmentName: firstEmbedded2(employee.departments)?.name ?? DASH2,
    positionName: firstEmbedded2(employee.positions)?.name ?? DASH2
  };
}
__name(toMember, "toMember");
function toCandidate(row) {
  return {
    employeeId: row.id,
    employeeCode: row.employee_code ?? DASH2,
    fullName: row.full_name ?? DASH2,
    departmentName: firstEmbedded2(row.departments)?.name ?? DASH2,
    positionName: firstEmbedded2(row.positions)?.name ?? DASH2
  };
}
__name(toCandidate, "toCandidate");
function encodeOrValue(value) {
  return encodeURIComponent(value).replace(/\(/g, "%28").replace(/\)/g, "%29");
}
__name(encodeOrValue, "encodeOrValue");
function buildEmployeeSearchFilter(pattern) {
  const nameClause = `full_name.ilike.${encodeOrValue(pattern)}`;
  const codeClause = `employee_code.ilike.${encodeOrValue(pattern)}`;
  return `or=(${nameClause},${codeClause})`;
}
__name(buildEmployeeSearchFilter, "buildEmployeeSearchFilter");
roster.get("/", async (c) => {
  const denied = await guard2(c);
  if (denied) return denied;
  try {
    const db = createDb(c.env);
    const { supId } = await findTypeIds(db);
    if (!supId) return c.json({ ok: false, message: TYPE_ERROR_MESSAGE }, 400);
    const rows = await db.select(ROSTER_TABLE2, {
      columns: MEMBER_FIELDS,
      filters: [
        ["meeting_type_id", "eq", supId],
        ["is_active", "eq", true]
      ]
    });
    const members = sortThai(rows.map(toMember));
    return c.json({ ok: true, count: members.length, members }, 200);
  } catch (error) {
    logError3(error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE2 }, 500);
  }
});
roster.get("/search", async (c) => {
  const denied = await guard2(c);
  if (denied) return denied;
  const rawUrl = new URL(c.req.raw.url);
  const query = normalizeSearchQuery(rawUrl.searchParams.get("q") ?? "");
  if (!isValidSearchQuery(query)) {
    return c.json({ ok: true, results: [] }, 200);
  }
  try {
    const db = createDb(c.env);
    const { supId } = await findTypeIds(db);
    if (!supId) return c.json({ ok: false, message: TYPE_ERROR_MESSAGE }, 400);
    const rosterRows = await db.select(ROSTER_TABLE2, {
      columns: "employee_id",
      filters: [
        ["meeting_type_id", "eq", supId],
        ["is_active", "eq", true]
      ]
    });
    const rosterIds = new Set(rosterRows.map((row) => row.employee_id));
    const pattern = `%${escapeIlike(query)}%`;
    const candidates = await db.select(EMPLOYEES_TABLE, {
      columns: EMPLOYEE_FIELDS,
      filters: [["is_active", "eq", true]],
      extra: [buildEmployeeSearchFilter(pattern)],
      limit: SEARCH_LIMIT
    });
    const merged = /* @__PURE__ */ new Map();
    for (const row of candidates) {
      if (rosterIds.has(row.id) || merged.has(row.id)) continue;
      merged.set(row.id, toCandidate(row));
    }
    const results = sortThai([...merged.values()]).slice(0, SEARCH_LIMIT);
    return c.json({ ok: true, results }, 200);
  } catch (error) {
    logError3(error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE2 }, 500);
  }
});
roster.post("/add", async (c) => {
  const denied = await guard2(c);
  if (denied) return denied;
  const body = await readStrictJson3(c);
  if (!isStrictEmployeeBody(body)) return invalidBody3(c);
  try {
    const db = createDb(c.env);
    const { supId, monthlyId } = await findTypeIds(db);
    if (!supId || !monthlyId) {
      return c.json({ ok: false, message: TYPE_ERROR_MESSAGE }, 400);
    }
    const employee = await db.select(EMPLOYEES_TABLE, {
      columns: "id,is_active",
      filters: [["id", "eq", body.employeeId]],
      single: true
    });
    if (!employee || employee.is_active !== true) {
      return c.json({ ok: false, message: EMPLOYEE_ERROR_MESSAGE }, 400);
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    for (const typeId of [supId, monthlyId]) {
      ensureOk3(
        await db.upsert(
          ROSTER_TABLE2,
          {
            meeting_type_id: typeId,
            employee_id: body.employeeId,
            is_active: true,
            created_by: authSession2(c).employeeId,
            created_at: now
          },
          { conflict: ROSTER_CONFLICT }
        )
      );
    }
    return c.json({ ok: true }, 200);
  } catch (error) {
    logError3(error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE2 }, 500);
  }
});
roster.post("/remove", async (c) => {
  const denied = await guard2(c);
  if (denied) return denied;
  const body = await readStrictJson3(c);
  if (!isStrictEmployeeBody(body)) return invalidBody3(c);
  try {
    const db = createDb(c.env);
    const { supId, monthlyId } = await findTypeIds(db);
    if (!supId || !monthlyId) {
      return c.json({ ok: false, message: TYPE_ERROR_MESSAGE }, 400);
    }
    let updatedCount = 0;
    for (const typeId of [supId, monthlyId]) {
      const result = await db.update(
        ROSTER_TABLE2,
        { is_active: false },
        [
          ["employee_id", "eq", body.employeeId],
          ["meeting_type_id", "eq", typeId]
        ],
        { returning: true, columns: "meeting_type_id" }
      );
      if (result.error) {
        const updateError = new Error("database write failed");
        updateError.code = result.error.code;
        throw updateError;
      }
      updatedCount += Array.isArray(result.data) ? result.data.length : 0;
    }
    if (updatedCount === 0) {
      return c.json({ ok: false, message: ROSTER_MESSAGE }, 404);
    }
    return c.json({ ok: true }, 200);
  } catch (error) {
    logError3(error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE2 }, 500);
  }
});
var meeting_roster_default = roster;

// src/meeting-overview.js
var BANGKOK_TIME_ZONE2 = "Asia/Bangkok";
var STATUS_LABEL_BY_CODE = {
  attended: "\u0E40\u0E02\u0E49\u0E32\u0E23\u0E48\u0E27\u0E21\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21",
  not_attended: "\u0E44\u0E21\u0E48\u0E40\u0E02\u0E49\u0E32\u0E23\u0E48\u0E27\u0E21",
  urgent_busy: "\u0E15\u0E34\u0E14\u0E07\u0E32\u0E19\u0E14\u0E48\u0E27\u0E19",
  leave: "\u0E25\u0E32\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21"
};
var STATUS_CODES = Object.keys(STATUS_LABEL_BY_CODE);
function bangkokClock(now) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BANGKOK_TIME_ZONE2,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(now);
}
__name(bangkokClock, "bangkokClock");
function countByStatus(rows) {
  const counts = { attended: 0, not_attended: 0, urgent_busy: 0, leave: 0, total: 0 };
  for (const row of rows ?? []) {
    const code = row?.status_code;
    if (typeof code !== "string" || code.length === 0) continue;
    counts.total += 1;
    if (STATUS_CODES.includes(code)) counts[code] += 1;
  }
  return counts;
}
__name(countByStatus, "countByStatus");
function findPending(roster2, attendanceRows) {
  const registered = new Set(
    (attendanceRows ?? []).map((row) => row?.employee_id).filter((id) => typeof id === "string" && id.length > 0)
  );
  return [...roster2 ?? []].filter((member) => !registered.has(member?.employeeId)).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), "th"));
}
__name(findPending, "findPending");
function sessionPhase({ now, openTime, cutoffTime }) {
  const open = normalizeTime(openTime);
  const cutoff = normalizeTime(cutoffTime);
  if (!now || !open || !cutoff) return "none";
  const current = bangkokClock(now);
  if (current < open) return "not_open";
  if (current >= cutoff) return "closed";
  return "open";
}
__name(sessionPhase, "sessionPhase");
function formatDateText(now) {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: BANGKOK_TIME_ZONE2,
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(now);
}
__name(formatDateText, "formatDateText");
function weekdayOf(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
__name(weekdayOf, "weekdayOf");
function todayOf(now) {
  return bangkokToday(now);
}
__name(todayOf, "todayOf");

// src/routes/meeting-overview.js
var overview = new Hono3();
var SERVER_ERROR_MESSAGE2 = "\u0E23\u0E30\u0E1A\u0E1A\u0E02\u0E31\u0E14\u0E02\u0E49\u0E2D\u0E07\u0E0A\u0E31\u0E48\u0E27\u0E04\u0E23\u0E32\u0E27 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07";
var TYPE_ERROR_MESSAGE2 = "\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17\u0E01\u0E32\u0E23\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07";
var DASH3 = "-";
var TYPES_TABLE3 = "meeting_types";
var SESSIONS_TABLE4 = "meeting_sessions";
var ATTENDANCE_TABLE2 = "meeting_attendance";
var ROSTER_TABLE3 = "meeting_roster";
var ROLE3 = "meeting_controller";
var MEMBER_FIELDS2 = "employee_id,employees!meeting_roster_employee_id_fkey!inner(full_name,departments(name),positions(name))";
var VALID_CODES = /* @__PURE__ */ new Set(["sup", "monthly"]);
overview.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});
function logError4(scope, error) {
  console.error(scope, { name: error?.name, code: error?.code });
}
__name(logError4, "logError");
function toHm3(value) {
  return normalizeTime(value);
}
__name(toHm3, "toHm");
async function findTypes(db) {
  const [sup, monthly] = await Promise.all([
    db.select(TYPES_TABLE3, {
      columns: "id,code,name,weekday,default_open_time,default_cutoff_time",
      filters: [["code", "eq", "sup"]],
      single: true
    }),
    db.select(TYPES_TABLE3, {
      columns: "id,code,name,weekday,default_open_time,default_cutoff_time",
      filters: [["code", "eq", "monthly"]],
      single: true
    })
  ]);
  return { sup, monthly };
}
__name(findTypes, "findTypes");
async function findSession(db, typeId, sessionDate) {
  if (!typeId) return null;
  return db.select(SESSIONS_TABLE4, {
    columns: "id,open_time,cutoff_time",
    filters: [
      ["meeting_type_id", "eq", typeId],
      ["session_date", "eq", sessionDate]
    ],
    single: true
  });
}
__name(findSession, "findSession");
async function loadCounts(db, sessionId) {
  if (!sessionId) return countByStatus([]);
  const rows = await db.select(ATTENDANCE_TABLE2, {
    columns: "status_code",
    filters: [["session_id", "eq", sessionId]]
  });
  return countByStatus(rows);
}
__name(loadCounts, "loadCounts");
async function loadRosterCount(db, typeId) {
  if (!typeId) return 0;
  const rows = await db.select(ROSTER_TABLE3, {
    columns: "employee_id",
    filters: [
      ["meeting_type_id", "eq", typeId],
      ["is_active", "eq", true]
    ]
  });
  return rows.length;
}
__name(loadRosterCount, "loadRosterCount");
function firstEmbedded3(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
__name(firstEmbedded3, "firstEmbedded");
async function guard3(c) {
  const auth2 = await requireRole(c.env, c.req.raw, [ROLE3]);
  if (auth2.status) {
    return c.json({ ok: false, message: auth2.message }, auth2.status);
  }
  return null;
}
__name(guard3, "guard");
overview.get("/", async (c) => {
  const denied = await guard3(c);
  if (denied) return denied;
  try {
    const db = createDb(c.env);
    const now = /* @__PURE__ */ new Date();
    const today = todayOf(now);
    const todayWeekday = weekdayOf(today);
    const { sup: supType, monthly: monthlyType } = await findTypes(db);
    const supRosterCount = await loadRosterCount(db, supType?.id ?? null);
    const isSupDay = supType !== null && supType.weekday === todayWeekday;
    let sup;
    if (!isSupDay) {
      sup = { hasSession: false, rosterCount: supRosterCount };
    } else {
      const session = await findSession(db, supType.id, today);
      const openTime = toHm3(supType?.default_open_time) ?? toHm3(session?.open_time);
      const cutoffTime = toHm3(supType?.default_cutoff_time) ?? toHm3(session?.cutoff_time);
      sup = {
        hasSession: true,
        openTime,
        cutoffTime,
        phase: sessionPhase({ now, openTime, cutoffTime }),
        counts: await loadCounts(db, session?.id ?? null),
        rosterCount: supRosterCount
      };
    }
    const monthlyRosterCount = await loadRosterCount(db, monthlyType?.id ?? null);
    const monthlySession2 = await findSession(db, monthlyType?.id ?? null, today);
    let monthly;
    if (!monthlySession2) {
      monthly = { hasSession: false, rosterCount: monthlyRosterCount };
    } else {
      const openTime = toHm3(monthlySession2.open_time);
      const cutoffTime = toHm3(monthlySession2.cutoff_time);
      monthly = {
        hasSession: true,
        openTime,
        cutoffTime,
        phase: sessionPhase({ now, openTime, cutoffTime }),
        counts: await loadCounts(db, monthlySession2.id),
        rosterCount: monthlyRosterCount
      };
    }
    return c.json({ ok: true, today: { dateText: formatDateText(now), sup, monthly } }, 200);
  } catch (error) {
    logError4("meeting overview failed", error);
    return c.json({ ok: false, message: SERVER_ERROR_MESSAGE2 }, 500);
  }
});
overview.get("/pending", async (c) => {
  const denied = await guard3(c);
  if (denied) return denied;
  const params = new URL(c.req.raw.url).searchParams;
  const queryKeys = [...params.keys()];
  const code = queryKeys.length === 1 && queryKeys[0] === "code" ? params.get("code") : null;
  if (!VALID_CODES.has(code)) {
    return c.json({ ok: false, message: TYPE_ERROR_MESSAGE2 }, 400);
  }
  try {
    const db = createDb(c.env);
    const today = todayOf(/* @__PURE__ */ new Date());
    const { sup: supType, monthly: monthlyType } = await findTypes(db);
    const type = code === "sup" ? supType : monthlyType;
    if (!type) return c.json({ ok: false, message: TYPE_ERROR_MESSAGE2 }, 400);
    const session = await findSession(db, type.id, today);
    if (!session) {
      return c.json({ ok: true, code, sessionDate: null, pending: [] }, 200);
    }
    const rosterRows = await db.select(ROSTER_TABLE3, {
      columns: MEMBER_FIELDS2,
      filters: [
        ["meeting_type_id", "eq", type.id],
        ["is_active", "eq", true]
      ]
    });
    const attendanceRows = await db.select(ATTENDANCE_TABLE2, {
      columns: "employee_id",
      filters: [["session_id", "eq", session.id]]
    });
    const roster2 = rosterRows.map((row) => {
      const employee = row.employees ?? {};
      return {
        employeeId: row.employee_id,
        fullName: employee.full_name ?? DASH3,
        departmentName: firstEmbedded3(employee.departments)?.name ?? DASH3,
        positionName: firstEmbedded3(employee.positions)?.name ?? DASH3
      };
    });
    const pending = findPending(roster2, attendanceRows).map((item) => ({
      fullName: item.fullName,
      departmentName: item.departmentName,
      positionName: item.positionName
    }));
    return c.json({ ok: true, code, sessionDate: today, pending }, 200);
  } catch (error) {
    logError4("meeting overview failed", error);
    return c.json({ ok: false, message: SERVER_ERROR_MESSAGE2 }, 500);
  }
});
var meeting_overview_default = overview;

// src/routes/meeting-monthly.js
var monthlySession = new Hono3();
var SAVE_ERROR_MESSAGE3 = "\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E44\u0E14\u0E49 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48";
var TYPE_ERROR_MESSAGE3 = "\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17\u0E01\u0E32\u0E23\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07";
var INVALID_BODY_MESSAGE4 = "\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07";
var PAST_DATE_MESSAGE = "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E15\u0E31\u0E49\u0E07\u0E41\u0E15\u0E48\u0E27\u0E31\u0E19\u0E19\u0E35\u0E49\u0E40\u0E1B\u0E47\u0E19\u0E15\u0E49\u0E19\u0E44\u0E1B";
var TYPES_TABLE4 = "meeting_types";
var SESSIONS_TABLE5 = "meeting_sessions";
var AUDIT_TABLE3 = "audit_logs";
var SESSION_CONFLICT = "meeting_type_id,session_date";
var LIST_LIMIT = 12;
var MAX_BODY_BYTES4 = 4 * 1024;
var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
var ROLE4 = "meeting_controller";
monthlySession.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});
function isPlainObject5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
__name(isPlainObject5, "isPlainObject");
function isJsonContentType4(value) {
  if (typeof value !== "string") return false;
  return value.split(";")[0].trim().toLowerCase() === "application/json";
}
__name(isJsonContentType4, "isJsonContentType");
async function readStrictJson4(c) {
  if (!isJsonContentType4(c.req.header("Content-Type"))) return null;
  const declaredLength = Number(c.req.header("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES4) return null;
  let text;
  try {
    text = await c.req.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES4) return null;
  try {
    const parsed = JSON.parse(text);
    return isPlainObject5(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
__name(readStrictJson4, "readStrictJson");
function invalidBody4(c) {
  return c.json({ ok: false, message: INVALID_BODY_MESSAGE4 }, 400);
}
__name(invalidBody4, "invalidBody");
function isStrictStringBody(value, keys) {
  if (!isPlainObject5(value)) return false;
  if (Object.keys(value).length !== keys.length) return false;
  return keys.every(
    (key) => Object.prototype.hasOwnProperty.call(value, key) && typeof value[key] === "string"
  );
}
__name(isStrictStringBody, "isStrictStringBody");
function logError5(error) {
  console.error("meeting monthly failed", { name: error?.name, code: error?.code });
}
__name(logError5, "logError");
function toHm4(value) {
  if (typeof value !== "string" || value.length < 5) return null;
  return value.slice(0, 5);
}
__name(toHm4, "toHm");
function ensureOk4(result) {
  if (result && result.error) {
    const error = new Error("database write failed");
    error.code = result.error.code;
    throw error;
  }
  return result;
}
__name(ensureOk4, "ensureOk");
function isCalendarDate(value) {
  const parsed = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}
__name(isCalendarDate, "isCalendarDate");
async function guard4(c) {
  const auth2 = await requireRole(c.env, c.req.raw, [ROLE4]);
  if (auth2.status) {
    return c.json({ ok: false, message: auth2.message }, auth2.status);
  }
  c.set("meetingSession", auth2.session);
  return null;
}
__name(guard4, "guard");
function authSession3(c) {
  return c.get("meetingSession");
}
__name(authSession3, "authSession");
async function findMonthlyTypeId(db) {
  const type = await db.select(TYPES_TABLE4, {
    columns: "id",
    filters: [["code", "eq", "monthly"]],
    single: true
  });
  return type ? type.id : null;
}
__name(findMonthlyTypeId, "findMonthlyTypeId");
monthlySession.get("/", async (c) => {
  const denied = await guard4(c);
  if (denied) return denied;
  try {
    const db = createDb(c.env);
    const typeId = await findMonthlyTypeId(db);
    if (!typeId) return c.json({ ok: false, message: TYPE_ERROR_MESSAGE3 }, 400);
    const rows = await db.select(SESSIONS_TABLE5, {
      columns: "id,session_date,open_time,cutoff_time",
      filters: [
        ["meeting_type_id", "eq", typeId],
        ["session_date", "gte", bangkokToday()]
      ],
      order: "session_date.asc",
      limit: LIST_LIMIT
    });
    const sessions = rows.map((row) => ({
      id: row.id,
      sessionDate: row.session_date,
      openTime: toHm4(row.open_time),
      cutoffTime: toHm4(row.cutoff_time)
    }));
    return c.json({ ok: true, sessions }, 200);
  } catch (error) {
    logError5(error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE3 }, 500);
  }
});
monthlySession.put("/", async (c) => {
  const denied = await guard4(c);
  if (denied) return denied;
  const body = await readStrictJson4(c);
  if (!isStrictStringBody(body, ["sessionDate", "openTime", "cutoffTime"])) {
    return invalidBody4(c);
  }
  if (!DATE_PATTERN.test(body.sessionDate) || !isCalendarDate(body.sessionDate)) {
    return invalidBody4(c);
  }
  const validation = validateWindow({ openTime: body.openTime, cutoffTime: body.cutoffTime });
  if (!validation.ok) return c.json({ ok: false, message: validation.message }, 400);
  if (body.sessionDate < bangkokToday()) {
    return c.json({ ok: false, message: PAST_DATE_MESSAGE }, 400);
  }
  try {
    const db = createDb(c.env);
    const typeId = await findMonthlyTypeId(db);
    if (!typeId) return c.json({ ok: false, message: TYPE_ERROR_MESSAGE3 }, 400);
    const { data: saved, error } = await db.upsert(
      SESSIONS_TABLE5,
      {
        meeting_type_id: typeId,
        session_date: body.sessionDate,
        cycle_key: `monthly-${body.sessionDate}`,
        open_time: body.openTime,
        cutoff_time: body.cutoffTime
      },
      { conflict: SESSION_CONFLICT, columns: "id" }
    ) ?? {};
    if (error) {
      const upsertError = new Error("database write failed");
      upsertError.code = error.code;
      throw upsertError;
    }
    if (!saved || !saved.id) throw new Error("session upsert returned no row");
    ensureOk4(
      await db.insert(AUDIT_TABLE3, {
        actor_id: authSession3(c).employeeId,
        action: "meeting_monthly_session_set",
        entity: "meeting_session",
        entity_id: saved.id,
        detail: JSON.stringify({
          sessionDate: body.sessionDate,
          openTime: body.openTime,
          cutoffTime: body.cutoffTime
        })
      })
    );
    return c.json({ ok: true }, 200);
  } catch (error) {
    logError5(error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE3 }, 500);
  }
});
var meeting_monthly_default = monthlySession;

// src/app.js
var app = new Hono3();
app.route("/api/auth", auth_default);
app.route("/api/register", register_default);
app.route("/api/meeting/monthly-session", meeting_monthly_default);
app.route("/api/meeting/roster", meeting_roster_default);
app.route("/api/meeting/overview", meeting_overview_default);
app.route("/api/meeting", meeting_default);
var app_default = app;

// src/rate-limiter.js
var WINDOW_MS = 60 * 1e3;
var SCHEMA = `
  CREATE TABLE IF NOT EXISTS rate_limit (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    count INTEGER NOT NULL,
    window_start INTEGER NOT NULL
  )
`;
function applyFixedWindow(sql, limit, nowMs = Date.now(), windowMs = WINDOW_MS) {
  const rows = sql.exec("SELECT count, window_start FROM rate_limit WHERE id = 1").toArray();
  const current = rows[0];
  let count;
  if (!current || nowMs - Number(current.window_start) >= windowMs) {
    count = 1;
    sql.exec(
      "INSERT INTO rate_limit (id, count, window_start) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET count = excluded.count, window_start = excluded.window_start",
      count,
      nowMs
    );
  } else {
    count = Number(current.count) + 1;
    sql.exec("UPDATE rate_limit SET count = ? WHERE id = 1", count);
  }
  return { success: count <= limit, count };
}
__name(applyFixedWindow, "applyFixedWindow");
var SqliteFixedWindowLimiter = class {
  static {
    __name(this, "SqliteFixedWindowLimiter");
  }
  constructor(ctx, env, limit, now) {
    this.ctx = ctx;
    this.env = env;
    this.limit = limit;
    this.now = now;
    ctx.storage.sql.exec(SCHEMA).toArray();
  }
  async fetch(request) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const result = applyFixedWindow(this.ctx.storage.sql, this.limit, this.now());
    return Response.json({ success: result.success });
  }
};
var ContextRateLimiter = class extends SqliteFixedWindowLimiter {
  static {
    __name(this, "ContextRateLimiter");
  }
  constructor(ctx, env, now = () => Date.now()) {
    super(ctx, env, 100, now);
  }
};
var SubmitIpRateLimiter = class extends SqliteFixedWindowLimiter {
  static {
    __name(this, "SubmitIpRateLimiter");
  }
  constructor(ctx, env, now = () => Date.now()) {
    super(ctx, env, 30, now);
  }
};
var SubmitTokenRateLimiter = class extends SqliteFixedWindowLimiter {
  static {
    __name(this, "SubmitTokenRateLimiter");
  }
  constructor(ctx, env, now = () => Date.now()) {
    super(ctx, env, 60, now);
  }
};

// src/index.js
var src_default = {
  fetch: app_default.fetch
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
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

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
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
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-rXG9ON/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
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

// .wrangler/tmp/bundle-rXG9ON/middleware-loader.entry.ts
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
  ContextRateLimiter,
  SubmitIpRateLimiter,
  SubmitTokenRateLimiter,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
