import { useEffect } from "react";
import "../../total-results/styles.css";
import { bootLegacyDashboard } from "./legacyBoot.js";

export default function TotalResultsItems() {
  useEffect(() => {
    bootLegacyDashboard("items");
  }, []);

  return (
    <main className="site-shell item-page">
      <header className="hero-shell compact-hero">
        <nav className="top-nav" aria-label="SVT dashboard pages">
          <div className="nav-clusters">
            <div className="analysis-switcher" aria-label="분석 방식">
              <a className="analysis-option active" href="index.html" aria-current="page">개인분석</a>
              <a className="analysis-option" href="insights.html">그룹분석</a>
            </div>
            <div className="dataset-switcher" data-dataset-switcher aria-label="결과 탭">
              <a className="dataset-option" href="../index.html">실험결과보기</a>
              <a className="dataset-option" data-dataset-option="svt" href="index.html">SVT</a>
              <a className="dataset-option" href="maze.html">RSVP</a>
            </div>
          </div>
          <a className="brand" href="../index.html">SVT Studio</a>
        </nav>
        <section className="hero-grid">
          <div>
            <p className="eyebrow">single select</p>
            <h1>개인 분석</h1>
            <p id="itemSummary" className="summary-text">참가자 1명을 선택하세요.</p>
          </div>
          <div className="control-card">
            <label className="search-label" htmlFor="participantSelect">검색</label>
            <select id="participantSelect" className="search-input"></select>
          </div>
        </section>
      </header>

      <section className="dashboard-panel">
        <section className="panel-section feature-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">individual overview</p>
              <h2 id="selectedParticipantTitle">선택하세요</h2>
              <p id="selectedParticipantMeta" className="summary-text"></p>
            </div>
          </div>
          <div className="chart-grid">
            <article className="chart-card">
              <div className="chart-card-heading">
                <h3>모델</h3>
                <div className="model-legend" aria-label="범례">
                  <span><i className="dot-red"></i>실제</span>
                  <span><i className="line-blue"></i>예측</span>
                </div>
              </div>
              <svg id="modelChart" className="chart" viewBox="0 0 720 340"></svg>
              <div id="modelEquations" className="model-equations" aria-label="함수식"></div>
            </article>
          </div>
        </section>

        <section className="panel-section">
          <div className="section-heading compact"><div><p className="eyebrow">personal confusion matrix</p><h2>O/X 응답 분석</h2></div></div>
          <div id="confusionList" className="confusion-list"></div>
        </section>

        <section className="panel-section">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">answer transition by next test</p>
              <h2>이전→다음 정오답 변화</h2>
              <p className="summary-text">공통 문항 중 양쪽 회차 모두 응답한 문항 기준</p>
            </div>
          </div>
          <div id="transitionList" className="transition-list"></div>
          <div className="transition-line-panel">
            <div className="legend transition-line-legend" aria-label="전환 그래프 범례">
              <span className="legend-item"><span className="swatch swatch-red"></span>모르는 내용(오답 유지)</span>
              <span className="legend-item"><span className="swatch swatch-yellow"></span>실수(정답→오답)</span>
            </div>
            <svg id="transitionLineChart" className="chart transition-line-chart" viewBox="0 0 1040 500" role="img" aria-label="오답 유지와 정답에서 오답 전환 개수 그래프"></svg>
          </div>
        </section>

        <section id="itemMapSection" className="panel-section">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">common 176 items</p>
              <h2>문항 지도</h2>
              <p id="itemMapSummary" className="summary-text">공통 문항 176개</p>
            </div>
            <div className="graph-controls item-map-controls">
              <div className="legend item-legend item-map-legend">
                <span className="legend-item"><span className="grass-swatch green"></span>정답</span>
                <span className="legend-item"><span className="grass-swatch red"></span>오답</span>
                <span className="legend-item"><span className="grass-swatch gray"></span>미실시</span>
              </div>
              <div id="itemMapMode" className="transition-filter item-map-mode-filter" aria-label="문항 지도 기준"></div>
            </div>
          </div>
          <div id="itemGrid" className="item-grid-panel"></div>
        </section>
      </section>
    </main>
  );
}
