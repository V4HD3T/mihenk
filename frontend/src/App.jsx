import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/AuthContext';
import { useT } from './i18n/index.jsx';

// Sign-in is the first thing most visits need, so it stays in the entry chunk.
import Login from './pages/Login';

/**
 * Every other page is split out.
 *
 * v0.2.0 roughly doubled the amount of interface, and the whole application
 * was one 740 KB chunk that every visitor downloaded before seeing a login
 * form - including the Monaco editor, the charting library and the teacher's
 * administration screens, none of which a signed-out visitor can reach. The
 * heaviest routes are now fetched when they are first opened.
 */
const Register = lazy(() => import('./pages/Register'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const StudentDashboard = lazy(() => import('./pages/StudentDashboard'));
const TeacherPanel = lazy(() => import('./pages/TeacherPanel'));
const ProblemSolve = lazy(() => import('./pages/ProblemSolve'));
const StudentExams = lazy(() => import('./pages/StudentExams'));
const ExamView = lazy(() => import('./pages/ExamView'));
const ExamAdmin = lazy(() => import('./pages/ExamAdmin'));
const StudentsPage = lazy(() => import('./pages/StudentsPage'));
const StudentDetail = lazy(() => import('./pages/StudentDetail'));
const SubmissionsView = lazy(() => import('./pages/SubmissionsView'));
const MySubmissions = lazy(() => import('./pages/MySubmissions'));
const SimilarityReport = lazy(() => import('./pages/SimilarityReport'));
const ArchivePage = lazy(() => import('./pages/ArchivePage'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Courses = lazy(() => import('./pages/Courses'));
const CourseRoster = lazy(() => import('./pages/CourseRoster'));

function Home() {
  const { user } = useAuth();
  return user.role === 'teacher' ? <TeacherPanel /> : <StudentDashboard />;
}

/** Shown while a route's chunk is in flight. */
function RouteFallback() {
  const t = useT();
  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <p role="status" className="text-inkmuted">
        {t('common.loading')}
      </p>
    </div>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-paper text-ink font-body">
      <Navbar />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          {/* Reached from an emailed link, so these must work signed out. */}
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route
            path="/problem/:id"
            element={
              <ProtectedRoute>
                <ProblemSolve />
              </ProtectedRoute>
            }
          />
          <Route
            path="/analytics"
            element={
              <ProtectedRoute>
                <Analytics />
              </ProtectedRoute>
            }
          />
          <Route
            path="/courses"
            element={
              <ProtectedRoute>
                <Courses />
              </ProtectedRoute>
            }
          />
          <Route
            path="/courses/:id/roster"
            element={
              <ProtectedRoute role="teacher">
                <CourseRoster />
              </ProtectedRoute>
            }
          />

          {/* Student-only */}
          <Route
            path="/my-exams"
            element={
              <ProtectedRoute role="student">
                <StudentExams />
              </ProtectedRoute>
            }
          />
          <Route
            path="/my-submissions"
            element={
              <ProtectedRoute role="student">
                <MySubmissions />
              </ProtectedRoute>
            }
          />
          <Route
            path="/exam/:id"
            element={
              <ProtectedRoute>
                <ExamView />
              </ProtectedRoute>
            }
          />

          {/* Teacher-only */}
          <Route
            path="/students"
            element={
              <ProtectedRoute role="teacher">
                <StudentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/students/:id"
            element={
              <ProtectedRoute role="teacher">
                <StudentDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/exam/:id"
            element={
              <ProtectedRoute role="teacher">
                <ExamAdmin />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/submissions/:id"
            element={
              <ProtectedRoute role="teacher">
                <SubmissionsView />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/similarity/:id"
            element={
              <ProtectedRoute role="teacher">
                <SimilarityReport />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/archive"
            element={
              <ProtectedRoute role="teacher">
                <ArchivePage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </Suspense>
    </div>
  );
}
