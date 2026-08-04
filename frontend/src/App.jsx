import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/AuthContext';

import Login from './pages/Login';
import Register from './pages/Register';
import StudentDashboard from './pages/StudentDashboard';
import TeacherPanel from './pages/TeacherPanel';
import ProblemSolve from './pages/ProblemSolve';
import StudentExams from './pages/StudentExams';
import ExamView from './pages/ExamView';
import StudentsPage from './pages/StudentsPage';
import SubmissionsView from './pages/SubmissionsView';
import SimilarityReport from './pages/SimilarityReport';
import Analytics from './pages/Analytics';
import Courses from './pages/Courses';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import CourseRoster from './pages/CourseRoster';

function Home() {
  const { user } = useAuth();
  return user.role === 'teacher' ? <TeacherPanel /> : <StudentDashboard />;
}

export default function App() {
  return (
    <div className="min-h-screen bg-paper text-ink font-body">
      <Navbar />
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
      </Routes>
    </div>
  );
}
