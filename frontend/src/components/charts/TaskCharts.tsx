import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface DonutDatum {
  label: string;
  value: number;
  color?: string;
}

interface DonutChartProps {
  data: DonutDatum[];
  colors?: string[];
}

interface VerticalBarDatum {
  label: string;
  value: number;
  color?: string;
}

interface VerticalBarChartProps {
  data: VerticalBarDatum[];
  barColor?: string;
  valueFormatter?: (value: number) => string;
  tooltipValueLabel?: string;
  allowDecimalAxis?: boolean;
}

interface HorizontalBarDatum {
  label: string;
  value: number;
}

interface HorizontalBarChartProps {
  data: HorizontalBarDatum[];
  barColor?: string;
  valueFormatter?: (value: number) => string;
  tooltipValueLabel?: string;
  allowDecimalAxis?: boolean;
}

interface IndicatorDatum {
  label: string;
  value: number;
  color?: string;
}

// Technical HUD Palette
const DEFAULT_COLORS = ["#00f3ff", "#39ff14", "#ffb020", "#ff5f87", "#47a9ff", "#a68dff"];
const CHART_GRID_COLOR = "var(--chart-grid)";
const CHART_AXIS_COLOR = "var(--chart-axis)";
const CHART_TICK_COLOR = "var(--chart-tick)";
const CHART_LABEL_COLOR = "var(--chart-label)";
const CHART_TOOLTIP_TEXT = "var(--chart-tooltip-text)";
const CHART_CURSOR_FILL = "var(--chart-cursor)";

function formatIndicatorValue(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 100 || Number.isInteger(value)) {
    return Math.round(value).toLocaleString("pt-BR");
  }
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function truncateIndicatorLabel(label: string): string {
  return label.length > 24 ? `${label.slice(0, 21)}...` : label;
}

const chartTooltipStyle = {
  backgroundColor: "var(--chart-tooltip-bg)",
  border: "1px solid var(--chart-tooltip-border)",
  borderRadius: "8px",
  color: CHART_TOOLTIP_TEXT,
  fontFamily: "IBM Plex Mono, monospace",
  fontSize: "11px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  boxShadow: "0 12px 30px rgba(2, 8, 20, 0.35)",
  backdropFilter: "blur(6px)",
};

const MobileIndicatorList = ({
  data,
  valueFormatter = formatIndicatorValue,
}: {
  data: IndicatorDatum[];
  valueFormatter?: (value: number) => string;
}) => (
  <ul className="chart-mobile-indicators">
    {data.map((item, index) => (
      <li key={`${item.label}-${index}`} className="chart-mobile-indicator-item">
        <span className="chart-mobile-indicator-label-wrap">
          <span
            className="chart-mobile-indicator-dot"
            style={item.color ? { backgroundColor: item.color } : undefined}
          />
          <span className="chart-mobile-indicator-label">{truncateIndicatorLabel(item.label)}</span>
        </span>
        <span className="chart-mobile-indicator-value">{valueFormatter(item.value)}</span>
      </li>
    ))}
  </ul>
);

export const DonutChart = ({ data, colors = DEFAULT_COLORS }: DonutChartProps) => {
  const normalizedData = data.map((entry, index) => ({
    ...entry,
    color: entry.color || colors[index % colors.length],
  }));
  const total = normalizedData.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="chart-shell">
      <div className="chart-canvas">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={normalizedData}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={65}
              outerRadius={85}
              stroke="rgba(0,0,0,0.5)"
              strokeWidth={2}
              paddingAngle={4}
            >
              {normalizedData.map((entry, index) => (
                <Cell key={`${entry.label}-${index}`} fill={entry.color} fillOpacity={0.9} />
              ))}
              <Label
                value={`TOTAL ${formatIndicatorValue(total)}`}
                position="center"
                fill={CHART_LABEL_COLOR}
                fontFamily="IBM Plex Mono"
                fontSize={11}
                fontWeight={600}
              />
            </Pie>
            <Tooltip
              contentStyle={chartTooltipStyle}
              itemStyle={{ color: CHART_TOOLTIP_TEXT }}
              formatter={(value: number) => [value, "QUANTIDADE"]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <MobileIndicatorList data={normalizedData} />
    </div>
  );
};

export const VerticalBarChartKpi = ({
  data,
  barColor = "#00f3ff",
  valueFormatter = formatIndicatorValue,
  tooltipValueLabel = "VALOR",
  allowDecimalAxis = false,
}: VerticalBarChartProps) => {
  const normalizedData = data.map((entry) => ({
    ...entry,
    color: entry.color || barColor,
  }));

  return (
    <div className="chart-shell">
      <div className="chart-canvas">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={normalizedData} margin={{ top: 24, right: 16, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke={CHART_GRID_COLOR} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: CHART_TICK_COLOR, fontSize: 9, fontFamily: "IBM Plex Mono" }}
              axisLine={{ stroke: CHART_AXIS_COLOR }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: CHART_TICK_COLOR, fontSize: 9, fontFamily: "IBM Plex Mono" }}
              axisLine={false}
              tickLine={false}
              allowDecimals={allowDecimalAxis}
            />
            <Tooltip
              cursor={{ fill: CHART_CURSOR_FILL }}
              contentStyle={chartTooltipStyle}
              formatter={(value: number) => [valueFormatter(value), tooltipValueLabel]}
            />
            <Bar dataKey="value" fill={barColor} radius={[0, 0, 0, 0]} maxBarSize={30}>
              {normalizedData.map((entry, index) => (
                <Cell key={`${entry.label}-${index}`} fill={entry.color} fillOpacity={0.8} />
              ))}
              <LabelList
                dataKey="value"
                position="top"
                offset={6}
                fill={CHART_LABEL_COLOR}
                fontFamily="IBM Plex Mono"
                fontSize={10}
                formatter={valueFormatter}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <MobileIndicatorList data={normalizedData} valueFormatter={valueFormatter} />
    </div>
  );
};

export const HorizontalBarChartKpi = ({
  data,
  barColor = "#00f3ff",
  valueFormatter = formatIndicatorValue,
  tooltipValueLabel = "VALOR",
  allowDecimalAxis = false,
}: HorizontalBarChartProps) => {
  const normalizedData = data.map((entry) => ({
    ...entry,
    color: barColor,
  }));

  return (
    <div className="chart-shell">
      <div className="chart-canvas">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={normalizedData}
            margin={{ top: 5, right: 46, left: 10, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="2 4" stroke={CHART_GRID_COLOR} horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: CHART_TICK_COLOR, fontSize: 9, fontFamily: "IBM Plex Mono" }}
              axisLine={false}
              tickLine={false}
              allowDecimals={allowDecimalAxis}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fill: CHART_TICK_COLOR, fontSize: 10, fontFamily: "IBM Plex Mono" }}
              axisLine={false}
              tickLine={false}
              width={100}
            />
            <Tooltip
              cursor={{ fill: CHART_CURSOR_FILL }}
              contentStyle={chartTooltipStyle}
              formatter={(value: number) => [valueFormatter(value), tooltipValueLabel]}
            />
            <Bar dataKey="value" fill={barColor} radius={[0, 2, 2, 0]} maxBarSize={20} fillOpacity={0.8}>
              <LabelList
                dataKey="value"
                position="right"
                offset={10}
                fill={CHART_LABEL_COLOR}
                fontFamily="IBM Plex Mono"
                fontSize={10}
                formatter={valueFormatter}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <MobileIndicatorList data={normalizedData} valueFormatter={valueFormatter} />
    </div>
  );
};
