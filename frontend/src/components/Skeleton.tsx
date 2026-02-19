import React from 'react';

interface SkeletonProps {
    className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className }) => {
    return (
        <div className={`animate-pulse rounded-md bg-white/5 ${className}`} />
    );
};

export const MetricSkeleton = () => (
    <div className="panel-rise border border-white/5 bg-black/20 p-5">
        <Skeleton className="h-3 w-20 mb-3" />
        <Skeleton className="h-8 w-16 mb-2" />
        <Skeleton className="h-3 w-24" />
    </div>
);

export const ChartSkeleton = () => (
    <div className="panel-rise border border-white/5 bg-black/20 p-5 h-[300px] flex flex-col">
        <Skeleton className="h-4 w-32 mb-4" />
        <div className="flex-1 flex items-end gap-2 px-2 pb-2">
            <Skeleton className="h-[40%] flex-1" />
            <Skeleton className="h-[70%] flex-1" />
            <Skeleton className="h-[50%] flex-1" />
            <Skeleton className="h-[90%] flex-1" />
            <Skeleton className="h-[60%] flex-1" />
        </div>
    </div>
);

export const TableRowSkeleton = () => (
    <div className="flex items-center gap-4 py-3 border-b border-white/5">
        <Skeleton className="h-4 w-8" />
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
    </div>
);
