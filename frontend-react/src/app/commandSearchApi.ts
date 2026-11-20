import {request} from "../shared/api/client";
import type {CommandSearchPayload} from "../shared/model/search";

export const commandSearchApi = {
  search: (query: string) => request<CommandSearchPayload>(`/api/search/?q=${encodeURIComponent(query)}`),
};
