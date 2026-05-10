import { useState, useCallback } from "react";

const BACKEND = "http://localhost:8000";

export default function useVideoSource() {
  const [sourceInput,   setSourceInput]   = useState("");
  const [localFilePath, setLocalFilePath] = useState(null);
  const [fileName,      setFileName]      = useState("");

  const setSource = useCallback((text) => {
    setSourceInput(text);
    setLocalFilePath(null);
    setFileName("");
  }, []);

  const handleUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const res  = await fetch(`${BACKEND}/upload`, { method: "POST", body: form });
    const data = await res.json();
    setLocalFilePath(data.file_path);
    setFileName(file.name);
    setSourceInput(file.name);
  }, []);

  return {
    sourceInput,
    localFilePath,
    fileName,
    setSource,
    handleUpload,
  };
}
