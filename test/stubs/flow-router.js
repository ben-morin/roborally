// Resolves `meteor/ostrio:flow-router-extra` for the client view modules. Every one of
// them reads the current game out of the route (`FlowRouter.getParam('_id')`), so tests
// set the route with setRoute() and then call helpers as if that page were open.
// Navigations are recorded rather than performed, so an event handler's redirect is
// assertable.
let params = {};
let routeName = '';
const navigations = [];

export const FlowRouter = {
  getParam: (key) => params[key],
  getQueryParam: () => undefined,
  getRouteName: () => routeName,
  // Real FlowRouter resolves a route name plus params into a URL. The exact shape does
  // not matter here as long as it round-trips into go() legibly.
  path(name, routeParams) {
    const query = routeParams
      ? `?${Object.entries(routeParams)
          .map(([k, v]) => `${k}=${v}`)
          .join('&')}`
      : '';
    return `${name}${query}`;
  },
  go(path) {
    navigations.push(path);
  },
  route() {},
  notFound: {},
  wait() {},
  initialize() {},
};

export function setRoute({ params: routeParams = {}, name = '' } = {}) {
  params = { ...routeParams };
  routeName = name;
}

/** Paths passed to FlowRouter.go() since the last reset, oldest first. */
export function navigations_() {
  return [...navigations];
}

export function resetRouter() {
  params = {};
  routeName = '';
  navigations.length = 0;
}
