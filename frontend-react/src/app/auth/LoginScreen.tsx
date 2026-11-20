import {useLayoutEffect, useState, type FormEvent} from "react";
import {LockKeyhole, RefreshCw} from "lucide-react";
import {Button} from "../../ui/controls/Button";
import {readAppPreferences} from "../preferences/appPreferences";

export function LoginScreen({busy, error, unavailable, onLogin, onRetry}: {
  busy: boolean;
  error: string;
  unavailable: boolean;
  onLogin: (username: string, password: string) => void;
  onRetry: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = readAppPreferences().preferences.theme;
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onLogin(username.trim(), password);
  };

  return (
    <main className="auth-screen" id="main-content">
      <div className="auth-content">
        <div className="auth-brand">
          <span className="auth-brand-mark" aria-hidden="true"><img src="/brand/logo.svg" alt="" /></span>
          <strong>Mis cuentas</strong>
        </div>
        <section className="auth-panel" aria-labelledby="auth-title">
          <div className="auth-heading">
            <span className="auth-heading-icon" aria-hidden="true"><LockKeyhole /></span>
            <div>
              <h1 id="auth-title">Inicia sesión</h1>
              <p>Accede a los datos financieros de esta instalación.</p>
            </div>
          </div>
          {unavailable ? (
            <div className="auth-unavailable">
              {error ? <p role="alert" className="message error">{error}</p> : null}
              <Button variant="secondary" fullWidth onClick={onRetry}>
                <RefreshCw aria-hidden="true" />
                Reintentar conexión
              </Button>
            </div>
          ) : (
            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="ui-field">
                <span className="ui-field__label">Usuario</span>
                <input
                  className="ui-input"
                  name="username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                  disabled={busy}
                />
              </label>
              <label className="ui-field">
                <span className="ui-field__label">Contraseña</span>
                <input
                  className="ui-input"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={busy}
                />
              </label>
              {error ? <p role="alert" className="message error auth-error">{error}</p> : null}
              <Button type="submit" variant="primary" fullWidth loading={busy} loadingLabel="Comprobando…">
                Entrar
              </Button>
              <p className="auth-note">Esta instalación no ofrece registro público.</p>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
