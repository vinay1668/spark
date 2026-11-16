import { useEffect } from "react";

// Observe once per page. Content stays readable if motion or observers are unavailable.
export function useReveal(rootRef, routeKey) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !("IntersectionObserver" in window)) return;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const elements = [...root.querySelectorAll("[data-reveal]")];
    let observer;
    const update = () => {
      observer?.disconnect();
      if (preference.matches) {
        elements.forEach((element) => element.classList.remove("is-revealed"));
        return;
      }
      observer = new IntersectionObserver((entries) => {
        entries.forEach(({ target, isIntersecting }) => {
          if (!isIntersecting) return;
          target.classList.add("is-revealed");
          observer.unobserve(target);
        });
      }, { threshold: 0.08 });
      elements.forEach((element) => observer.observe(element));
    };
    update();
    preference.addEventListener("change", update);
    return () => {
      observer?.disconnect();
      preference.removeEventListener("change", update);
    };
  }, [rootRef, routeKey]);
}
