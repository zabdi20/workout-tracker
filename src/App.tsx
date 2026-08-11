import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from './ui/AppLayout';
import { LibraryScreen } from './ui/library/LibraryScreen';
import { RoutinesScreen } from './ui/routines/RoutinesScreen';

export function App() {
  return (
    // basename comes from Vite's configured base so it stays in sync with
    // the GitHub Pages subpath rather than being hardcoded in two places.
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<p>Today lands in a later task.</p>} />
          <Route path="/routines" element={<RoutinesScreen />} />
          <Route path="/library" element={<LibraryScreen />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
