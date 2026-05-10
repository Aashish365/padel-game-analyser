import base64

import cv2
import numpy as np


def encode_frame(frame: np.ndarray, max_width: int = 1280) -> str:
    h, w = frame.shape[:2]
    if w > max_width:
        frame = cv2.resize(frame, (max_width, int(h * max_width / w)))
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 78])
    return base64.b64encode(buf).decode()
