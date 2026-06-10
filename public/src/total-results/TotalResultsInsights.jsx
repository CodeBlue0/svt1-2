import { useEffect } from "react";
import "../../total-results/styles.css";
import { bootLegacyDashboard } from "./legacyBoot.js";

export default function TotalResultsInsights() {
  useEffect(() => {
    bootLegacyDashboard("insights");
  }, []);

  return (
    <main className="site-shell insights-page">
      <header className="hero-shell compact-hero">
        <nav className="top-nav" aria-label="SVT dashboard pages">
          <div className="nav-clusters">
            <div className="analysis-switcher" aria-label="분석 방식">
              <a className="analysis-option" href="index.html">개인분석</a>
              <a className="analysis-option active" href="insights.html" aria-current="page">그룹분석</a>
            </div>
            <div className="dataset-switcher" data-dataset-switcher aria-label="결과 탭">
              <a className="dataset-option" data-dataset-option="svt" href="insights.html">SVT</a>
              <a className="dataset-option" href="maze.html">RSVP</a>
            </div>
          </div>
        </nav>
        <section className="hero-grid">
          <div>
            <p className="eyebrow">6-round change clustering</p>
            <h1>그룹별 분석</h1>
            <p id="clusterSummary" className="summary-text">6회 이상 제출자의 변화 곡선을 DTW로 분석하고 그래프는 9회까지 표시합니다.</p>
          </div>
          <div className="control-card">
            <label className="search-label">그룹 선택</label>
            <div id="groupList" className="group-select-list" role="radiogroup" aria-label="그룹 선택"></div>
          </div>
        </section>
      </header>

      <section className="dashboard-panel group-analysis-panel" aria-label="그룹별 분석">
        <section className="panel-section feature-panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">2D tendency manifold</p>
              <h2>참가자 경향 지도</h2>
              <p className="summary-text">DTW 거리행렬을 2D로 투영해, 비슷한 변화 곡선을 가진 참가자가 가깝게 보이도록 배치합니다.</p>
            </div>
            <div className="legend" id="manifoldLegend" aria-label="경향 지도 범례"></div>
          </div>
          <div className="chart-stage manifold-stage">
            <svg id="manifoldMap" className="chart manifold-chart" viewBox="0 0 1040 560" role="img" aria-label="참가자 변화 경향 2D 지도"></svg>
          </div>
        </section>

        <section className="panel-section feature-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">priority graph</p>
              <h2>RT × 정답률</h2>
              <p className="summary-text">선택 그룹의 회차별 평균 궤적</p>
            </div>
            <div className="graph-controls">
              <div className="legend">
                <span className="legend-item"><span className="swatch swatch-red"></span>그룹 평균</span>
                <span className="legend-item"><span className="swatch swatch-blue"></span>개인</span>
              </div>
              <div id="groupMemberControls" className="member-filter" aria-label="그룹 내 개인 선택"></div>
            </div>
          </div>
          <div className="chart-stage">
            <svg id="groupArrowChart" className="chart hero-chart" viewBox="0 0 1040 500" role="img" aria-label="그룹 평균 RT 정답률 그래프"></svg>
          </div>
        </section>

        <section className="metric-strip" aria-label="선택 그룹 요약">
          <article className="stat-card"><span>차수</span><strong id="groupSelectedRounds">-</strong></article>
          <article className="stat-card"><span>RT</span><strong id="groupSelectedRt">-</strong></article>
          <article className="stat-card"><span>정답률</span><strong id="groupSelectedAcc">-</strong></article>
        </section>

        <section className="panel-section">
          <div className="section-heading compact"><div><p className="eyebrow">selected group trends</p><h2>차수별 변화</h2></div></div>
          <div className="chart-grid two">
            <article className="chart-card"><h3>RT</h3><svg id="groupRtOverviewChart" className="chart" viewBox="0 0 720 320" role="img" aria-label="그룹 평균 RT 변화"></svg></article>
            <article className="chart-card"><h3>정답률</h3><svg id="groupAccuracyOverviewChart" className="chart" viewBox="0 0 720 320" role="img" aria-label="그룹 평균 정답률 변화"></svg></article>
          </div>
        </section>

        <section className="panel-section feature-panel">
          <div className="section-heading personal-heading">
            <div>
              <p className="eyebrow">group analysis</p>
              <h2 id="selectedGroupTitle">반응시간, 정확도 분석</h2>
              <p id="selectedGroupMeta" className="summary-text"></p>
            </div>
          </div>
          <div className="chart-grid">
            <article className="chart-card">
              <div className="chart-card-heading">
                <h3>모델</h3>
                <div className="model-legend" aria-label="범례">
                  <span><i className="dot-red"></i>그룹 평균</span>
                  <span><i className="line-blue"></i>변화선</span>
                  <span><i className="line-green"></i>지수근사</span>
                </div>
              </div>
              <svg id="groupModelChart" className="chart" viewBox="0 0 720 340" role="img" aria-label="그룹 평균 RT와 정답률 변화"></svg>
              <div id="groupModelEquations" className="model-equations" aria-label="그룹 평균 요약"></div>
            </article>
          </div>
        </section>

        <section className="panel-section">
          <div className="section-heading compact"><div><p className="eyebrow">group confusion matrix</p><h2>O/X 응답 분석</h2></div></div>
          <div id="groupConfusionList" className="confusion-list"></div>
        </section>

        <section className="panel-section">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">answer transition by next test</p>
              <h2>이전→다음 정오답 변화</h2>
              <p className="summary-text">각 개인의 공통 문항 전환 비율을 먼저 계산한 뒤 그룹 평균으로 표시합니다.</p>
            </div>
          </div>
          <div id="groupTransitionList" className="transition-list"></div>
          <div className="transition-line-panel">
            <div className="legend transition-line-legend" aria-label="전환 그래프 범례">
              <span className="legend-item"><span className="swatch swatch-red"></span>모르는 내용(오답 유지)</span>
              <span className="legend-item"><span className="swatch swatch-yellow"></span>실수(정답→오답)</span>
              <span className="legend-item"><span className="swatch swatch-green"></span>이동평균선</span>
            </div>
            <svg id="groupTransitionLineChart" className="chart transition-line-chart" viewBox="0 0 1040 500" role="img" aria-label="그룹 오답 유지와 정답에서 오답 전환 개수 그래프"></svg>
          </div>
        </section>
      </section>
    </main>
  );
}
