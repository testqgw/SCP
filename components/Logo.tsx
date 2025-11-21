import React from "react";

export const Logo = ({ className = "w-8 h-8" }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <path d="M12 2L3 7V12C3 17 7 21 12 22C17 21 21 17 21 12V7L12 2Z" className="fill-blue-600" />
        <path d="M12 16C14.2091 16 16 14.2091 16 12C16 9.79086 14.2091 8 12 8C9.79086 8 8 9.79086 8 12C8 14.2091 9.79086 16 12 16Z" className="fill-white" />
        <circle cx="12" cy="12" r="2" className="fill-blue-600" />
    </svg>
);
