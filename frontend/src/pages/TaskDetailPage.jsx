import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTaskStore } from '../store/taskStore';
import { api } from '../utils/api';
import TaskDetailModal from '../components/TaskDetailModal';

export default function TaskDetailPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const { tasks } = useTaskStore();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const numId = Number(taskId);
    const cached = tasks.find((t) => t.id === numId || String(t.id) === String(taskId));
    if (cached) {
      setTask(cached);
      setLoading(false);
      return;
    }
    api.getTask(taskId)
      .then((data) => { setTask(data.task || data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [taskId]);

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/app');
    }
  };

  if (loading) {
    return (
      <div className="task-detail-page-loading">
        <div className="spinner" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="task-detail-page-notfound">
        <p>Aufgabe nicht gefunden.</p>
        <button onClick={handleBack}>Zurück</button>
      </div>
    );
  }

  return (
    <TaskDetailModal
      pageMode
      task={task}
      onClose={handleBack}
      onUpdated={(updated) => setTask((prev) => ({ ...prev, ...updated }))}
    />
  );
}
