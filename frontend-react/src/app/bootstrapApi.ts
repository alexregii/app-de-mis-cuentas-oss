import {request} from "../shared/api/client";
import type {BootstrapPayload, OptionsPayload} from "../shared/model/bootstrap";

export const bootstrapApi = {
  bootstrap: () => request<BootstrapPayload>("/api/bootstrap/"),
  options: () => request<OptionsPayload>("/api/options/"),
};
