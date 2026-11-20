import {request} from "./client";

export const bankingApi = {
  syncBank: (id: number) => request(`/api/bank-connections/${id}/sync/`, {method: "POST"}),
  bankStatus: (id: number) => request(`/api/bank-connections/${id}/status/`),
  disconnectBank: (id: number) => request(`/api/bank-connections/${id}/disconnect/`, {method: "POST"}),
};
