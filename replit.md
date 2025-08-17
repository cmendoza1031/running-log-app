# Running Log App

## Overview

A mobile-first running log application that helps users track their running progress with an elegant ivory and sky blue design. The app features a clean, iOS-optimized interface with three main sections: Home (weekly mileage tracking), Journey (monthly calendar view), and Log Activity (activity logging). Built as a full-stack TypeScript application with React frontend and Express backend.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack Query for server state management
- **UI Components**: Radix UI primitives with shadcn/ui component library
- **Styling**: Tailwind CSS with custom ivory and sky blue color scheme
- **Forms**: React Hook Form with Zod validation
- **Charts**: Chart.js for weekly mileage visualization

### Backend Architecture
- **Runtime**: Node.js with Express.js server
- **Language**: TypeScript with ES modules
- **API Design**: RESTful API endpoints for run operations
- **Storage**: In-memory storage with interface for future database integration
- **Validation**: Zod schemas shared between client and server

### Data Storage
- **Current**: In-memory storage using Maps for development
- **Configured**: Drizzle ORM with PostgreSQL dialect ready for production
- **Schema**: User and runs tables with comprehensive run tracking fields
- **Migration**: Drizzle Kit for database migrations

### Component Design
- **Mobile-First**: Optimized for iOS with responsive design patterns
- **Bottom Navigation**: Three-tab interface (Home, Journey, Log)
- **Theming**: Custom CSS variables for consistent ivory/sky blue palette
- **Accessibility**: Proper ARIA labels and semantic HTML structure

### Form Architecture
- **Validation**: Client-side validation with Zod schemas
- **UX**: Real-time validation feedback with toast notifications
- **Data Types**: Structured run data including distance, pace, time, and run type
- **State**: Optimistic updates with query invalidation

## External Dependencies

### UI and Styling
- **Radix UI**: Complete set of accessible UI primitives
- **Tailwind CSS**: Utility-first CSS framework
- **Lucide React**: Icon library for consistent iconography
- **shadcn/ui**: Pre-built component library built on Radix

### Data and State Management
- **TanStack Query**: Server state management and caching
- **React Hook Form**: Form state management and validation
- **Zod**: Runtime type validation and schema definition

### Development Tools
- **Vite**: Fast build tool and development server
- **TypeScript**: Type safety across the entire application
- **ESBuild**: Fast JavaScript bundler for production builds

### Database (Configured)
- **Drizzle ORM**: Type-safe database toolkit
- **Neon Database**: Serverless PostgreSQL for production
- **Drizzle Kit**: Database migration and schema management

### Charts and Visualization
- **Chart.js**: Canvas-based charting library for weekly mileage display
- **Date-fns**: Date utility library for time-based calculations