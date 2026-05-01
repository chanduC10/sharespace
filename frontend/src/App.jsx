import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";

function App() {
  const navigate = useNavigate();

  useEffect(() => {
    const id = uuidv4();
    navigate(`/room/${id}`, { replace: true });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
      <div className="text-sm text-zinc-400">Creating room…</div>
    </div>
  );
}

export default App;
