import { Link } from "react-router-dom";
import { Logo } from "../components/ui";

export default function NotFound() {
  return (
    <main className="grid-paper grid min-h-screen place-items-center p-6">
      <div className="sheet max-w-md p-8 text-center">
        <Logo />
        <p className="label mt-6">Error 404 · cell out of bounds</p>
        <h1 className="mt-2 font-display text-3xl font-semibold">Nothing planted here.</h1>
        <p className="mt-2 text-ink-3">That page isn't part of this field.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link className="rounded-sm bg-ink px-4 py-2 text-sm text-paper" to="/">Home</Link>
          <Link className="rounded-sm border border-ink/30 px-4 py-2 text-sm" to="/app">Dashboard</Link>
        </div>
      </div>
    </main>
  );
}
