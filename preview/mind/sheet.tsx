import React from 'react';
import {theme} from '../../theme';
export function Sheet({visible,onClose,title,subtitle,children}:any){return visible?<div className="sheet-backdrop"><section style={{background:theme.colors.background.primary,padding:20,borderRadius:24}}><button onClick={onClose} style={{float:'right'}}>×</button><h3>{title}</h3><p>{subtitle}</p>{children}</section></div>:null}
