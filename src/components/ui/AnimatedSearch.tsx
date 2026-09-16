import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, X } from "lucide-react";

export interface AnimatedSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  expandedWidth?: number | string;
  inputClassName?: string;
  buttonClassName?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  title?: string;
  roundedFull?: boolean;
}

export function AnimatedSearch({
  value,
  onChange,
  placeholder = "Search...",
  className = "",
  expandedWidth = 260,
  inputClassName = "",
  buttonClassName = "",
  onKeyDown,
  title = "Search",
  roundedFull = false,
}: AnimatedSearchProps) {
  const [isOpen, setIsOpen] = useState(Boolean(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value && !isOpen) {
      setIsOpen(true);
    }
  }, [value]);

  const toggle = () => {
    if (!isOpen) {
      setIsOpen(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else if (!value) {
      setIsOpen(false);
    }
  };

  const shapeClass = roundedFull ? "rounded-full" : "rounded-xl";

  return (
    <div className={`relative flex items-center ${className}`}>
      <AnimatePresence initial={false}>
        {isOpen || Boolean(value) ? (
          <motion.div
            key="animated-search-input"
            initial={{ width: 34, opacity: 0 }}
            animate={{ width: expandedWidth, opacity: 1 }}
            exit={{ width: 34, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative flex items-center"
          >
            <Search className="pointer-events-none absolute left-2.5 size-3.5 text-zinc-400" />
            <input
              ref={inputRef}
              type="text"
              placeholder={placeholder}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (value) onChange("");
                  else setIsOpen(false);
                }
                onKeyDown?.(e);
              }}
              className={`h-8.5 w-full ${shapeClass} border border-zinc-200 bg-zinc-50/70 pl-8 pr-7 text-xs font-semibold text-zinc-800 transition-colors placeholder:text-zinc-400 focus:border-[#0059C6] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0059C6]/10 ${inputClassName}`}
            />
            <button
              type="button"
              onClick={() => {
                if (value) onChange("");
                else setIsOpen(false);
              }}
              className={`absolute right-1.5 flex size-5 items-center justify-center ${shapeClass} text-zinc-400 transition-colors hover:bg-zinc-200/70 hover:text-zinc-700 cursor-pointer`}
              title={value ? "Clear search" : "Close search"}
            >
              <X className="size-3" />
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="animated-search-btn"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            type="button"
            onClick={toggle}
            title={title}
            className={`flex size-8.5 items-center justify-center ${shapeClass} border border-zinc-200 bg-white text-zinc-600 shadow-2xs transition-all hover:border-[#0059C6] hover:text-[#0059C6] active:scale-95 cursor-pointer ${buttonClassName}`}
          >
            <Search className="size-3.5" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
