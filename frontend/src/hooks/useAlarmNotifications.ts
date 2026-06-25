/**
 * Hook: useAlarmNotifications
 * Watches the realtime alarm store and fires browser notifications + audio
 * for unacknowledged CRITICAL/EMERGENCY alarms that are newly received.
 */
import { useEffect, useRef } from 'react';
import { useRealtimeStore } from '../store';
import { Alarm } from '../types';

// Short beep using Web Audio API (no external files needed)
function playBeep(frequency = 880, duration = 0.15, volume = 0.3) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.value = frequency;
    gain.gain.value = volume;
    osc.start();
    osc.stop(ctx.currentTime + duration);
    setTimeout(() => ctx.close(), (duration + 0.1) * 1000);
  } catch {
    // Audio not available — silently skip
  }
}

function criticalBeep() {
  // Three descending beeps for CRITICAL
  playBeep(1200, 0.1, 0.25);
  setTimeout(() => playBeep(1000, 0.1, 0.25), 160);
  setTimeout(() => playBeep(800, 0.2, 0.3), 320);
}

export function useAlarmNotifications() {
  const alarms = useRealtimeStore((s) => s.activeAlarms);
  const seenIds = useRef<Set<string>>(new Set());
  const notifGranted = useRef<boolean>(false);

  // Request permission once
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then((perm) => {
        notifGranted.current = perm === 'granted';
      });
    } else {
      notifGranted.current = Notification.permission === 'granted';
    }
  }, []);

  useEffect(() => {
    const critical = alarms.filter(
      (a: Alarm) => !a.acknowledged && (a.severity === 'CRITICAL' || a.severity === 'EMERGENCY')
    );

    for (const alarm of critical) {
      if (!seenIds.current.has(alarm.alarm_id)) {
        seenIds.current.add(alarm.alarm_id);

        // Sound alert
        criticalBeep();

        // Browser notification
        if (notifGranted.current) {
          const n = new Notification(`⚠ ${alarm.severity}: ${alarm.fleet_number || 'Site'}`, {
            body: alarm.message || alarm.alarm_code,
            icon: '/favicon.ico',
            tag: alarm.alarm_id,
            requireInteraction: alarm.severity === 'EMERGENCY',
          });
          // Auto-close after 8s for CRITICAL
          if (alarm.severity === 'CRITICAL') setTimeout(() => n.close(), 8000);
        }
      }
    }

    // Clean seenIds for acknowledged alarms to avoid memory leak
    const activeIds = new Set(alarms.map((a: Alarm) => a.alarm_id));
    seenIds.current.forEach((id) => {
      if (!activeIds.has(id)) seenIds.current.delete(id);
    });
  }, [alarms]);
}
