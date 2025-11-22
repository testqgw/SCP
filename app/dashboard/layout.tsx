<Link
  href={href}
  className={`px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${active ? "text-white bg-slate-800" : "text-slate-400 hover:text-white hover:bg-slate-800/50"
    }`}
>
  {icon}
  {text}
</Link>
  )
}