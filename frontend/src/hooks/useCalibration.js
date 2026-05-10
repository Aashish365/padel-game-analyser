import { useState, useCallback } from "react";

export default function useCalibration() {
  const [calibrating, setCalibrating]           = useState(false);
  const [calibrationPoints, setCalibrationPoints]     = useState(null);
  const [calibrationCourtPts, setCalibrationCourtPts] = useState(null);
  const [calibrationBoundary, setCalibrationBoundary] = useState(null);
  const [calibrationMarks, setCalibrationMarks]       = useState(null);
  const [calibrationLineSegs, setCalibrationLineSegs] = useState(null);
  const [calibrationData, setCalibrationData]         = useState(null);

  const applyCalibration = useCallback((imagePts, courtPts, calibData, boundary) => {
    setCalibrationPoints(imagePts);
    setCalibrationCourtPts(courtPts);
    setCalibrationBoundary(boundary);
    setCalibrationMarks(calibData?.marks ?? null);
    setCalibrationLineSegs(calibData?.lineSegs ?? null);
    setCalibrationData(calibData);
    setCalibrating(false);
  }, []);

  return {
    calibrating,
    setCalibrating,
    calibrationPoints,
    calibrationCourtPts,
    calibrationBoundary,
    calibrationMarks,
    calibrationLineSegs,
    calibrationData,
    applyCalibration,
  };
}
