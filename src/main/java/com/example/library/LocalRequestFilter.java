package com.example.library;

import java.io.IOException;
import java.net.URI;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class LocalRequestFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
        response.setHeader("X-Content-Type-Options","nosniff");
        response.setHeader("X-Frame-Options","DENY");
        response.setHeader("Referrer-Policy","no-referrer");
        response.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'");
        if(request.getRequestURI().startsWith("/api/")) {
            response.setHeader("Cache-Control","no-store");
            String host=request.getServerName();
            if(!host.equals("localhost")&&!host.equals("127.0.0.1")&&!host.equals("[::1]")&&!host.equals("::1")) {response.sendError(403);return;}
            if(!request.getMethod().equals("GET")&&!request.getMethod().equals("HEAD")) {
                String origin=request.getHeader("Origin");
                boolean valid="library-local".equals(request.getHeader("X-Library-Client"));
                if(origin!=null) {
                    try {var uri=URI.create(origin);valid=valid&&uri.getScheme().equals(request.getScheme())&&uri.getHost().equals(host)&&(uri.getPort()==-1?80:uri.getPort())==request.getServerPort();}
                    catch(Exception ex) {valid=false;}
                }
                if(!valid) {response.sendError(403);return;}
            }
        }
        chain.doFilter(request,response);
    }
}
