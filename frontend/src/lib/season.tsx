import { createContext, useContext, useState, type ReactNode } from "react";
import { DEFAULT_DAY } from "./api";

const Ctx = createContext<{ day: number; setDay: (d: number) => void }>({ day: DEFAULT_DAY, setDay: () => {} });

/** The season day being viewed is shared across the whole dashboard. */
export function SeasonProvider({ children }: { children: ReactNode }) {
  const [day, setDay] = useState(DEFAULT_DAY);
  return <Ctx.Provider value={{ day, setDay }}>{children}</Ctx.Provider>;
}

export const useSeason = () => useContext(Ctx);
