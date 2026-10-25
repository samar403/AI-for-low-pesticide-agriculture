import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { Loading } from "./components/ui";
import { SeasonProvider } from "./lib/season";
import Landing from "./pages/Landing";

const Overview = lazy(() => import("./pages/Overview"));
const FieldWorkspace = lazy(() => import("./pages/FieldWorkspace"));
const Prescriptions = lazy(() => import("./pages/Prescriptions"));
const Scout = lazy(() => import("./pages/Scout"));
const Telemetry = lazy(() => import("./pages/Telemetry"));
const ModelPage = lazy(() => import("./pages/ModelPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

export default function App() {
  return (
    <Suspense fallback={<div className="p-10"><Loading /></div>}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/app"
          element={
            <SeasonProvider>
              <AppLayout />
            </SeasonProvider>
          }
        >
          <Route index element={<Overview />} />
          <Route path="fields/:fieldId" element={<FieldWorkspace />} />
          <Route path="prescriptions" element={<Prescriptions />} />
          <Route path="scout" element={<Scout />} />
          <Route path="telemetry" element={<Telemetry />} />
          <Route path="model" element={<ModelPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
