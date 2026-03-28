import { useEffect, useState } from "react";

// VIOLATION: addEventListener without cleanup
export function WindowResizeTracker() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
  }, []);
  return <div>Width: {width}</div>;
}

// CLEAN: addEventListener with proper cleanup
export function WindowResizeTrackerClean() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return <div>Width: {width}</div>;
}

// VIOLATION: setInterval without clearInterval
export function PollingComponent() {
  const [data, setData] = useState(null);
  useEffect(() => {
    const id = setInterval(() => {
      fetch("/api/data").then((r) => r.json()).then(setData);
    }, 5000);
  }, []);
  return <div>{JSON.stringify(data)}</div>;
}

// CLEAN: setInterval with clearInterval cleanup
export function PollingComponentClean() {
  const [data, setData] = useState(null);
  useEffect(() => {
    const id = setInterval(() => {
      fetch("/api/data").then((r) => r.json()).then(setData);
    }, 5000);
    return () => clearInterval(id);
  }, []);
  return <div>{JSON.stringify(data)}</div>;
}

// VIOLATION: subscribe without unsubscribe
export function EventStreamComponent({ stream }: { stream: any }) {
  const [events, setEvents] = useState<any[]>([]);
  useEffect(() => {
    stream.subscribe((event: any) => {
      setEvents((prev) => [...prev, event]);
    });
  }, [stream]);
  return <ul>{events.map((e, i) => <li key={i}>{e}</li>)}</ul>;
}

// CLEAN: subscribe with unsubscribe cleanup
export function EventStreamComponentClean({ stream }: { stream: any }) {
  const [events, setEvents] = useState<any[]>([]);
  useEffect(() => {
    const sub = stream.subscribe((event: any) => {
      setEvents((prev) => [...prev, event]);
    });
    return () => sub.unsubscribe();
  }, [stream]);
  return <ul>{events.map((e, i) => <li key={i}>{e}</li>)}</ul>;
}

// CLEAN: Simple effect with no subscription (no cleanup needed)
export function TitleUpdater({ title }: { title: string }) {
  useEffect(() => {
    document.title = title;
  }, [title]);
  return null;
}
