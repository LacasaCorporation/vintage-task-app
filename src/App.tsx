import { BrowserRouter, Routes, Route } from "react-router";
import { RequireAuth } from "@/components/RequireAuth";
import Dashboard from "@/pages/Dashboard";
import MaterialPage from "@/pages/MaterialPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/materials/:id?"
          element={
            <RequireAuth>
              <MaterialPage />
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
