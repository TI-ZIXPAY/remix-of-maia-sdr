import React from 'react';
import { Building2, User, Eye, MapPin, Phone } from 'lucide-react';
import { motion } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface StepIdentityProps {
  companyName: string;
  sdrName: string;
  city: string;
  brokerName: string;
  brokerPhone: string;
  onCompanyNameChange: (value: string) => void;
  onSdrNameChange: (value: string) => void;
  onCityChange: (value: string) => void;
  onBrokerNameChange: (value: string) => void;
  onBrokerPhoneChange: (value: string) => void;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { type: "spring" as const, stiffness: 300, damping: 24 }
  },
};

export const StepIdentity: React.FC<StepIdentityProps> = ({
  companyName,
  sdrName,
  city,
  brokerName,
  brokerPhone,
  onCompanyNameChange,
  onSdrNameChange,
  onCityChange,
  onBrokerNameChange,
  onBrokerPhoneChange,
}) => {
  return (
    <motion.div 
      className="space-y-8"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={itemVariants} className="text-center mb-8">
        <motion.div 
          className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30 flex items-center justify-center"
          whileHover={{ scale: 1.05, rotate: 5 }}
          transition={{ type: "spring", stiffness: 400 }}
        >
          <Building2 className="w-8 h-8 text-primary" />
        </motion.div>
        <h3 className="text-xl font-semibold text-foreground mb-2">Identidade da Empresa</h3>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          Configure como sua empresa e agente de IA serão identificados no sistema.
        </p>
      </motion.div>

      <div className="space-y-6 max-w-md mx-auto">
        <motion.div variants={itemVariants} className="space-y-2">
          <Label htmlFor="companyName" className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-muted-foreground" />
            Nome da Empresa / Imobiliária
          </Label>
          <Input
            id="companyName"
            value={companyName}
            onChange={(e) => onCompanyNameChange(e.target.value)}
            placeholder="Ex: Imobiliária XYZ"
            className="focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground">Aparecerá no header e comunicações</p>
        </motion.div>

        <motion.div variants={itemVariants} className="space-y-2">
          <Label htmlFor="sdrName" className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            Nome do Agente
          </Label>
          <Input
            id="sdrName"
            value={sdrName}
            onChange={(e) => onSdrNameChange(e.target.value)}
            placeholder="Ex: Manu, Julia, Pedro..."
            className="focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground">Nome que a IA usará ao se apresentar</p>
        </motion.div>

        <motion.div variants={itemVariants} className="space-y-2">
          <Label htmlFor="city" className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-muted-foreground" />
            Cidade de Atuação
          </Label>
          <Input
            id="city"
            value={city}
            onChange={(e) => onCityChange(e.target.value)}
            placeholder="Ex: São Paulo, Curitiba"
            className="focus:ring-primary"
          />
        </motion.div>

        <motion.div variants={itemVariants} className="space-y-2">
          <Label htmlFor="brokerName" className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            Nome do Corretor Responsável
          </Label>
          <Input
            id="brokerName"
            value={brokerName}
            onChange={(e) => onBrokerNameChange(e.target.value)}
            placeholder="Corretor que assume após qualificação"
            className="focus:ring-primary"
          />
        </motion.div>

        <motion.div variants={itemVariants} className="space-y-2">
          <Label htmlFor="brokerPhone" className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-muted-foreground" />
            Telefone do Corretor
          </Label>
          <Input
            id="brokerPhone"
            value={brokerPhone}
            onChange={(e) => onBrokerPhoneChange(e.target.value)}
            placeholder="Ex: (11) 99999-9999"
            className="focus:ring-primary"
          />
        </motion.div>
      </div>

      {/* Preview */}
      {(companyName || sdrName) && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
          className="mt-8 p-4 rounded-xl bg-secondary/30 border border-border max-w-md mx-auto"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
            <Eye className="w-3 h-3" />
            Preview
          </div>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              <span className="text-muted-foreground/70">Empresa:</span>{' '}
              <span className="text-foreground font-medium">{companyName || 'Sua Empresa'}</span>
            </p>
            <p className="text-muted-foreground">
              <span className="text-muted-foreground/70">Agente:</span>{' '}
              <span className="text-primary font-medium">{sdrName || 'Agente'}</span>
            </p>
            {city && (
              <p className="text-muted-foreground">
                <span className="text-muted-foreground/70">Cidade:</span>{' '}
                <span className="text-foreground font-medium">{city}</span>
              </p>
            )}
            {brokerName && (
              <p className="text-muted-foreground">
                <span className="text-muted-foreground/70">Corretor:</span>{' '}
                <span className="text-foreground font-medium">{brokerName}</span>
                {brokerPhone && <span className="text-muted-foreground/70"> — {brokerPhone}</span>}
              </p>
            )}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};
