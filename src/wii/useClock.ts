import { useEffect, useState } from "react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface WiiTime {
  hh: string;
  mm: string;
  ampm: "AM" | "PM";
  date: string; // e.g. "Fri 1/1"
  colonOn: boolean; // blinking colon
}

function read(): WiiTime {
  const d = new Date();
  let h = d.getHours();
  const ampm: "AM" | "PM" = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return {
    hh: String(h),
    mm: String(d.getMinutes()).padStart(2, "0"),
    ampm,
    date: `${DAYS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`,
    colonOn: d.getSeconds() % 2 === 0,
  };
}

/** Live Wii-style clock. Updates twice a second so the colon can blink. */
export function useClock(): WiiTime {
  const [t, setT] = useState<WiiTime>(read);
  useEffect(() => {
    const id = setInterval(() => setT(read()), 500);
    return () => clearInterval(id);
  }, []);
  return t;
}
