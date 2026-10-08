import { useEffect, useState } from 'react';
import { getDesktopStatus, subscribeDesktopStatus, type DesktopStatus } from '../services/desktopModel';

export function useDesktopModelStatus(): DesktopStatus {
  const [status, setStatus] = useState<DesktopStatus>(getDesktopStatus);
  useEffect(() => {
    setStatus(getDesktopStatus());
    return subscribeDesktopStatus(setStatus);
  }, []);
  return status;
}
