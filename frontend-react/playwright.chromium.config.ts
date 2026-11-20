import base from "./playwright.config";

export default {
  ...base,
  projects: base.projects?.filter((project) => project.name === "chromium"),
  webServer: Array.isArray(base.webServer) ? base.webServer.slice(0, 2) : base.webServer,
};
