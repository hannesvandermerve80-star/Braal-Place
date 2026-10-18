import { useState, type ImgHTMLAttributes } from "react";

/** <img> with a graceful branded fallback when a remote photo fails to load. */
export default function SmartImage({ src, alt, ...rest }: ImgHTMLAttributes<HTMLImageElement>) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div aria-label={alt} className="img-fallback" role="img" style={rest.style}>
        <svg fill="none" height="34" viewBox="0 0 24 24" width="34"><g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"><path d="M6 8h12l1 13H5L6 8Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></g></svg>
      </div>
    );
  }
  return <img alt={alt} loading="lazy" onError={() => setFailed(true)} src={src} {...rest} />;
}
