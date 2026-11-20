import base from "./playwright.config";

export default {
  ...base,
  projects: base.projects?.filter((project) => project.name === "webkit"),
  webServer: Array.isArray(base.webServer) ? base.webServer.slice(2, 4) : base.webServer,
};
