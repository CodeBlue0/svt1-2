import { useEffect } from "react";
import "../../total-results/styles.css";
import { bootLegacyDashboard } from "./legacyBoot.js";

export default function TotalResultsIndex() {
  useEffect(() => {
    bootLegacyDashboard("index");
  }, []);

  return (
    <main className="site-shell">
      <header className="hero-shell">
        <nav className="top-nav" aria-label="SVT dashboard pages">
          <div className="nav-clusters">
            <div className="analysis-switcher" aria-label="분석 방식">
              <a className="analysis-option active" href="index.html" aria-current="page">개인분석</a>
              <a className="analysis-option" href="insights.html">그룹분석</a>
            </div>
            <div className="dataset-switcher" data-dataset-switcher aria-label="결과 탭">
              <a className="dataset-option" data-dataset-option="svt" href="index.html">SVT</a>
              <a className="dataset-option" data-dataset-option="rsvp" href="index.html?dataset=rsvp">RSVP</a>
              <a className="dataset-option" data-dataset-option="maze" href="index.html?dataset=maze">MAZE</a>
            </div>
          </div>
        </nav>
        <section className="hero-grid">
          <div>
            <p className="eyebrow">single select · average optional</p>
            <h1>SVT</h1>
            <p id="datasetSummary" className="summary-text">로딩 중...</p>
          </div>
          <div className="control-card">
            <label className="search-label" htmlFor="nameSearch">검색</label>
            <div className="search-row">
              <input id="nameSearch" className="search-input" type="search" autoComplete="off" placeholder="ID 입력" />
              <button id="selectVisible" className="button" type="button">검색</button>
              <button id="clearSelection" className="button ghost" type="button">초기화</button>
            </div>
          </div>
        </section>
        <section className="name-panel" aria-label="참가자">
          <div id="nameList" className="name-list"></div>
        </section>
      </header>

      <section className="dashboard-panel">
        <section className="panel-section feature-panel">
          <div className="section-heading">
            <div>
              <p id="priorityEyebrow" className="eyebrow">priority graph</p>
              <h2 id="priorityTitle">RT × 정답률</h2>
              <p id="prioritySummary" className="summary-text">빨강=선택, 노랑=평균</p>
            </div>
            <div className="graph-controls">
              <div className="legend">
                <span className="legend-item"><span className="swatch swatch-red"></span>선택</span>
                <span className="legend-item"><span className="swatch swatch-yellow"></span>평균</span>
                <span className="legend-item"><span className="swatch swatch-green"></span>이동평균선</span>
              </div>
              <button id="zoomToSelection" className="button ghost graph-zoom-button" type="button" aria-pressed="false">확대</button>
              <div id="transitionFilter" className="transition-filter" aria-label="구간"></div>
            </div>
          </div>
          <div className="chart-stage">
            <svg id="arrowChart" className="chart hero-chart" viewBox="0 0 1040 500" role="img" aria-label="RT 정답률 그래프"></svg>
          </div>
        </section>

        <section className="metric-strip" aria-label="요약">
          <article className="stat-card"><span>차수</span><strong id="selectedRounds">-</strong></article>
          <article className="stat-card"><span>RT</span><strong id="selectedRt">-</strong></article>
          <article className="stat-card"><span>정답률</span><strong id="selectedAcc">-</strong></article>
        </section>

        <section className="panel-section">
          <div className="section-heading compact">
            <div>
              <p id="trendEyebrow" className="eyebrow">selected participant trends</p>
              <h2 id="trendTitle">차수별 변화</h2>
            </div>
          </div>
          <div className="chart-grid two">
            <article className="chart-card">
              <h3 id="rtOverviewTitle">RT</h3>
              <svg id="rtOverviewChart" className="chart" viewBox="0 0 720 320" role="img" aria-label="다중 참가자 RT 변화"></svg>
            </article>
            <article className="chart-card">
              <h3 id="accuracyOverviewTitle">정답률</h3>
              <svg id="accuracyOverviewChart" className="chart" viewBox="0 0 720 320" role="img" aria-label="정답률 변화"></svg>
            </article>
          </div>
        </section>
      </section>

      <section className="dashboard-panel individual-analysis-panel" aria-label="개인 분석">
        <section className="panel-section feature-panel">
          <div className="section-heading personal-heading">
            <div>
              <p id="modelEyebrow" className="eyebrow">individual analysis</p>
              <h2 id="selectedParticipantTitle">반응시간, 정확도 분석</h2>
              <p id="selectedParticipantMeta" className="summary-text"></p>
            </div>
          </div>
          <div className="chart-grid">
            <article className="chart-card">
              <div className="chart-card-heading">
                <h3 id="modelCardTitle">모델</h3>
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
              <span className="legend-item"><span className="swatch swatch-red"></span>모르는 내용 (오답 유지)</span>
              <span className="legend-item"><span className="swatch swatch-yellow"></span>실수 (정답→오답)</span>
            </div>
            <svg id="transitionLineChart" className="chart transition-line-chart" viewBox="0 0 1040 500" role="img" aria-label="오답 유지와 정답에서 오답 전환 개수 그래프"></svg>
          </div>
        </section>

        <section id="itemMapSection" className="panel-section item-map-section">
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
