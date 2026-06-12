/**
 * The signed-in account chip (email + sign out). Renders nothing when auth is
 * disabled, so it's safe to drop into any chrome unconditionally. It lays out
 * in-flow — the parent decides where it sits (toolbar right group, picker corner).
 */
import { useAccount } from "./session-context.js";
import "./auth.css";

export function AccountMenu() {
  const account = useAccount();
  if (!account) return null;
  return (
    <div className="account-chip" role="status">
      <span className="account-email" title={account.user.email}>
        {account.user.email}
      </span>
      <button type="button" className="account-signout" onClick={() => void account.signOut()}>
        Sign out
      </button>
    </div>
  );
}
