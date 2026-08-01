import React from "react";
import { LuArrowLeft as ArrowLeft } from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";

interface ContentHeroProps {
  title: string;
  background?: string;
  logo?: string;
  year?: string | number;
  runtime?: string;
  rating?: string | number;
  genres?: string[];
  tags?: string[];
  onBack: () => void;
}

export const ContentHero: React.FC<ContentHeroProps> = ({
  title,
  background,
  logo,
  year,
  runtime,
  rating,
  genres,
  tags,
  onBack,
}) => {
  const normalizedRating = String(rating || "")
    .replace(/\s*\/\s*10$/i, "")
    .trim();
  const facts = [year, runtime, ...(genres || []), ...(tags || [])]
    .filter(Boolean)
    .map(String)
    .filter((item, index, items) => items.indexOf(item) === index)
    .slice(0, 6);

  return (
    <section className="content-hero" aria-labelledby="content-detail-title">
      <div className="content-hero-media">
        <div
          className="content-hero-artwork"
          style={{ backgroundImage: background ? `url(${background})` : undefined }}
          aria-hidden="true"
        />
        <div className="content-hero-scrim" />
        <FocusableButton
          className="content-back-button"
          onClick={onBack}
          focusKey="CONTENT_BACK"
          title="Go back"
        >
          <ArrowLeft size={22} />
        </FocusableButton>
      </div>

      <div className="content-hero-inner">
        <div className="content-hero-title-row">
          <div className="content-hero-copy">
            {logo ? (
              <img className="content-hero-logo" src={logo} alt={title} />
            ) : (
              <h1 id="content-detail-title">{title}</h1>
            )}
            {logo && (
              <h1 id="content-detail-title" className="sr-only">
                {title}
              </h1>
            )}
          </div>
          {normalizedRating && (
            <div className="content-rating" aria-label={`${normalizedRating} out of 10`}>
              <strong>{normalizedRating}</strong>
              <span>/10</span>
            </div>
          )}
        </div>
        {facts.length > 0 && (
          <div className="content-facts" aria-label="Content information">
            {facts.map((fact) => (
              <span key={fact}>
                {fact}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
