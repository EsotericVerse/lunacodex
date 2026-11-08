'use client';

// Display only: the existing statistics queries own all values.
export default function StatisticsDashboardKpis({items=[],label='Statistics'}){
  return <div className="statistics-dashboard__kpis" aria-label={label}>
    {items.map(item=><div className="statistics-dashboard__kpi" key={item.key}>
      <span className="statistics-dashboard__kpi-label">{item.label}</span>
      <strong className="statistics-dashboard__kpi-value">{item.value}</strong>
    </div>)}
  </div>;
}
