import {request, setCsrfToken} from "../../shared/api/client";

export type AuthSession = {
  ok: true;
  required: boolean;
  authenticated: boolean;
  username: string | null;
  expires_at: string | null;
  csrf_token: string;
};

export const authApi = {
  session: async () => {
    const session = await request<AuthSession>("/api/auth/session/", {cache: "no-store"});
    setCsrfToken(session.csrf_token);
    return session;
  },
  login: async (username: string, password: string) => {
    const session = await request<AuthSession>("/api/auth/login/", {
      method: "POST",
      body: JSON.stringify({username, password}),
    });
    setCsrfToken(session.csrf_token);
    return session;
  },
  logout: async () => {
    const session = await request<AuthSession>("/api/auth/logout/", {
      method: "POST",
      body: JSON.stringify({}),
    });
    setCsrfToken(session.csrf_token);
    return session;
  },
};
