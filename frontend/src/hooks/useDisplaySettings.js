import { useState } from "react";

export default function useDisplaySettings() {
  const [show2D,     setShow2D]     = useState(false);
  const [showZones,  setShowZones]  = useState(true);
  const [showLines,  setShowLines]  = useState(true);
  const [showPoses,  setShowPoses]  = useState(true);

  return {
    show2D,    setShow2D,
    showZones, setShowZones,
    showLines, setShowLines,
    showPoses, setShowPoses,
  };
}
