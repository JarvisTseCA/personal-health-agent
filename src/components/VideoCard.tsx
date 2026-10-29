import { useState } from "react";
import { embedOf, thumbnailOf, watchOf, type Video } from "../lib/moves";
import { PlayIcon } from "./Icons";

/**
 * A how-to video the coach shares in the conversation. Shows the thumbnail
 * first and loads the YouTube player (privacy-enhanced mode) only when tapped.
 */
export function VideoCard({ video }: { video: Video }) {
  const [playing, setPlaying] = useState(false);
  return (
    <figure className="video-card">
      <div className="video-frame">
        {playing ? (
          <iframe
            src={embedOf(video)}
            title={video.title}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button className="video-poster" onClick={() => setPlaying(true)} aria-label={`Play: ${video.title}`}>
            <img src={thumbnailOf(video)} alt="" loading="lazy" />
            <span className="video-play"><PlayIcon /></span>
            <span className="video-len">{video.length}</span>
          </button>
        )}
      </div>
      <figcaption>
        <b>{video.title}</b>
        <span className="xs muted">{video.channel} · <a href={watchOf(video)} target="_blank" rel="noreferrer">Watch on YouTube</a></span>
      </figcaption>
    </figure>
  );
}
